// "Create your sandbox" from the dashboard: makes the owner account, then the vault,
// guardian and agent accounts. Keys are written to <dir>/.keys and never leave this machine.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Actions {
  createAccount(): unknown;
  transfer(yocto: string): unknown;
  addFullAccessKey(a: { publicKey: string }): unknown;
  addLimitedAccessKey(a: { publicKey: string; allowance: string; accountId: string; methodNames: string[] }): unknown;
  deployContract(a: { codeBase64: string }): unknown;
  functionCall(a: { methodName: string; args: unknown; gas: string; deposit: string }): unknown;
}
export interface NearOps {
  actions: Actions;
  newKeyPair(): { privateKey: string; publicKey: string };
  createFundedAccount(accountId: string, publicKey: string): Promise<unknown>;
  sendTx(a: { signerId: string; privateKey: string; receiverId: string; actions: unknown[] }): Promise<unknown>;
  accountExists(accountId: string): Promise<boolean | null>;
}
export interface SetupDeps { ops: NearOps; dir: string; wasmDirs?: string[] }

export type Stage = "no_owner" | "owner_ready" | "deployed";
export interface SetupStatus {
  stage: Stage;
  owner?: string;
  vault?: string;
  agent?: string;
  guardian?: string;
  agentKeyFile?: string;
}

export class SetupError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const Y = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
export const HARD_PER_TX = Y(3);
export const HARD_DAILY = Y(6);
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

export function validName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name) && name.length >= 3;
}

const keysDir = (dir: string) => path.join(dir, ".keys");
const keyPath = (dir: string, id: string) => path.join(keysDir(dir), `${id}.json`);
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

function ownerAccount(dir: string): string | null {
  const k = keysDir(dir);
  if (!fs.existsSync(k)) return null;
  const owners = fs.readdirSync(k)
    .filter((f) => /^[a-z0-9-]+\.testnet\.json$/.test(f))
    .map((f) => ({ id: f.slice(0, -5), t: fs.statSync(path.join(k, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return owners[0]?.id ?? null;
}

export function getStatus(dir: string): SetupStatus {
  const depFile = path.join(dir, "deployment.json");
  if (fs.existsSync(depFile)) {
    const dep = readJson(depFile);
    // A deployment file copied from someone else has no guardian key here, so it does not count.
    if (fs.existsSync(keyPath(dir, dep.guardian))) {
      return { stage: "deployed", owner: dep.owner, vault: dep.vault, agent: dep.agent, guardian: dep.guardian, agentKeyFile: `.keys/${dep.agent}.json` };
    }
  }
  const owner = ownerAccount(dir);
  return owner ? { stage: "owner_ready", owner } : { stage: "no_owner" };
}

export async function createOwner(d: SetupDeps, name: unknown): Promise<string> {
  if (!validName(name)) {
    throw new SetupError(422, "Use 3 to 30 lowercase letters, digits or hyphens, for example: alice-agents");
  }
  if (getStatus(d.dir).stage !== "no_owner") throw new SetupError(409, "An owner account already exists on this machine.");
  const accountId = `${name}.testnet`;
  const { privateKey, publicKey } = d.ops.newKeyPair();
  fs.mkdirSync(keysDir(d.dir), { recursive: true });
  const file = keyPath(d.dir, accountId);
  fs.writeFileSync(file, JSON.stringify({ accountId, publicKey, privateKey }, null, 2), { mode: 0o600 });
  try {
    await d.ops.createFundedAccount(accountId, publicKey);
  } catch (e: any) {
    fs.rmSync(file, { force: true }); // nothing was created, do not leave an orphan key
    throw new SetupError(502, `The testnet faucet could not create ${accountId}. The name may be taken; try another. (${String(e?.message ?? e).slice(0, 120)})`);
  }
  return accountId;
}

function findWasm(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findWasm(p); if (r) return r; }
    else if (e.name.endsWith(".wasm")) return p;
  }
  return null;
}

function assertOk(result: unknown, step: string) {
  const text = JSON.stringify(result ?? {});
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic || /"Failure"/.test(text)) throw new SetupError(502, `${step} failed${panic ? `: ${panic[1].trim()}` : ""}.`);
}

function ensureKey(dir: string, id: string, ops: NearOps): string {
  const file = keyPath(dir, id);
  if (fs.existsSync(file)) return readJson(file).publicKey;
  const { privateKey, publicKey } = ops.newKeyPair();
  fs.mkdirSync(keysDir(dir), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ accountId: id, publicKey, privateKey }, null, 2), { mode: 0o600 });
  return publicKey;
}

export async function deploySandbox(d: SetupDeps) {
  const status = getStatus(d.dir);
  if (status.stage === "deployed") throw new SetupError(409, "A sandbox is already deployed here.");
  if (status.stage !== "owner_ready" || !status.owner) throw new SetupError(409, "Create the owner account first.");
  const owner = status.owner;
  const ownerKey = readJson(keyPath(d.dir, owner)).privateKey as string;
  const wasmPath = (d.wasmDirs ?? ["contract/prebuilt", "artifacts"]).map(findWasm).find(Boolean) ?? null;
  if (!wasmPath) throw new SetupError(500, "The contract file is missing (contract/prebuilt/agentguard_vault.wasm).");
  const wasm = fs.readFileSync(wasmPath);

  const vault = `vault.${owner}`;
  const guardian = `guardian.${owner}`;
  const agent = `agent.${owner}`;
  const guardianPub = ensureKey(d.dir, guardian, d.ops);
  const agentPub = ensureKey(d.dir, agent, d.ops);
  const A = d.ops.actions;
  const txs: Record<string, string | null> = {};

  const send = async (label: string, receiverId: string, actions: unknown[]) => {
    try {
      const r = await d.ops.sendTx({ signerId: owner, privateKey: ownerKey, receiverId, actions });
      assertOk(r, label);
    } catch (e: any) {
      if (e instanceof SetupError) throw e;
      const msg = String(e?.message ?? e);
      if (/NotEnoughBalance|not enough balance/i.test(msg)) throw new SetupError(402, `The owner account does not have enough testnet NEAR for ${label}. It needs about 9 NEAR.`);
      throw new SetupError(502, `${label} failed: ${msg.slice(0, 160)}`);
    }
  };

  if ((await d.ops.accountExists(vault)) === true) {
    throw new SetupError(409, `${vault} already exists from an earlier attempt. Use a new sandbox name.`);
  }
  if ((await d.ops.accountExists(guardian)) !== true) {
    await send("Creating the guardian account", guardian, [A.createAccount(), A.transfer(Y(1)), A.addFullAccessKey({ publicKey: guardianPub })]);
  }
  if ((await d.ops.accountExists(agent)) !== true) {
    await send("Creating the agent account", agent, [
      A.createAccount(), A.transfer(Y(1)),
      A.addLimitedAccessKey({ publicKey: agentPub, allowance: Y(0.25), accountId: vault, methodNames: ["request_payment"] }),
    ]);
  }
  // Create, fund, deploy and initialise in ONE transaction: nobody can front-run the init.
  await send("Deploying the vault", vault, [
    A.createAccount(), A.transfer(Y(6)),
    A.deployContract({ codeBase64: wasm.toString("base64") }),
    A.functionCall({ methodName: "new", args: { owner, guardian, agent, hard_per_tx: HARD_PER_TX, hard_daily: HARD_DAILY }, gas: "30 Tgas", deposit: "0" }),
  ]);

  const deployment = {
    network: "testnet", owner, vault, guardian, agent,
    guardianPublicKey: guardianPub, agentPublicKey: agentPub,
    agentKeyScope: { receiver: vault, methods: ["request_payment"], allowanceNEAR: 0.25 },
    hardCaps: { perTxYocto: HARD_PER_TX, dailyYocto: HARD_DAILY },
    wasmSha256: crypto.createHash("sha256").update(wasm).digest("hex"),
    txs,
  };
  fs.writeFileSync(path.join(d.dir, "deployment.json"), JSON.stringify(deployment, null, 2));
  return deployment;
}
