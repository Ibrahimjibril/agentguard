import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOwner, deploySandbox, getStatus, validName, SetupError } from "./setup.ts";
import type { NearOps } from "./setup.ts";

const tag = (type: string) => (a?: any) => ({ type, ...(typeof a === "string" ? { v: a } : a ?? {}) });
const actions = {
  createAccount: tag("CreateAccount"), transfer: tag("Transfer"), addFullAccessKey: tag("AddFull"),
  addLimitedAccessKey: tag("AddLimited"), deployContract: tag("Deploy"), functionCall: tag("Call"),
};

function fixture(opts: { faucetFails?: boolean; failStep?: string; existing?: string[]; wasm?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-setup-"));
  if (opts.wasm !== false) {
    fs.mkdirSync(path.join(dir, "contract/prebuilt"), { recursive: true });
    fs.writeFileSync(path.join(dir, "contract/prebuilt/agentguard_vault.wasm"), "WASM");
  }
  const sent: { receiverId: string; types: string[]; signerId: string }[] = [];
  let n = 0;
  const ops: NearOps = {
    actions: actions as any,
    newKeyPair: () => { n++; return { privateKey: `ed25519:priv${n}`, publicKey: `ed25519:pub${n}` }; },
    createFundedAccount: async () => { if (opts.faucetFails) throw new Error("taken"); return {}; },
    sendTx: async (a) => {
      sent.push({ receiverId: a.receiverId, signerId: a.signerId, types: (a.actions as any[]).map((x) => x.type) });
      if (opts.failStep && a.receiverId.startsWith(opts.failStep)) return { status: { Failure: {} } };
      return { ok: true };
    },
    accountExists: async (id) => (opts.existing ?? []).includes(id),
  };
  const deps = { ops, dir, wasmDirs: [path.join(dir, "contract/prebuilt")] };
  return { dir, deps, sent };
}

test("names are validated", () => {
  assert.equal(validName("alice-agents"), true);
  for (const bad of ["ab", "Alice", "has space", "-lead", "trail-", "a".repeat(40), "dot.name", 5, null]) assert.equal(validName(bad), false);
});
test("a fresh folder starts at no_owner", () => {
  const { dir } = fixture();
  assert.equal(getStatus(dir).stage, "no_owner");
});
test("createOwner saves the key (private file) and asks the faucet", async () => {
  const { dir, deps } = fixture();
  const id = await createOwner(deps, "alice-agents");
  assert.equal(id, "alice-agents.testnet");
  const file = path.join(dir, ".keys/alice-agents.testnet.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).privateKey, "ed25519:priv1");
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.deepEqual(getStatus(dir), { stage: "owner_ready", owner: "alice-agents.testnet" });
});
test("a failed faucet call leaves no orphan key and explains why", async () => {
  const { dir, deps } = fixture({ faucetFails: true });
  await assert.rejects(() => createOwner(deps, "alice-agents"), /faucet could not create/);
  assert.equal(fs.existsSync(path.join(dir, ".keys/alice-agents.testnet.json")), false);
  assert.equal(getStatus(dir).stage, "no_owner");
});
test("an invalid name or a second owner is refused", async () => {
  const { deps } = fixture();
  await assert.rejects(() => createOwner(deps, "AB"), (e: any) => e instanceof SetupError && e.status === 422);
  await createOwner(deps, "alice-agents");
  await assert.rejects(() => createOwner(deps, "other-name"), (e: any) => e instanceof SetupError && e.status === 409);
});
test("deploy needs an owner first", async () => {
  const { deps } = fixture();
  await assert.rejects(() => deploySandbox(deps), /Create the owner account first/);
});
test("deploy creates guardian, agent, then the vault in ONE atomic transaction", async () => {
  const { dir, deps, sent } = fixture();
  await createOwner(deps, "alice-agents");
  const dep = await deploySandbox(deps);
  assert.deepEqual(sent.map((s) => s.receiverId), ["guardian.alice-agents.testnet", "agent.alice-agents.testnet", "vault.alice-agents.testnet"]);
  assert.ok(sent.every((s) => s.signerId === "alice-agents.testnet"));
  assert.deepEqual(sent[1].types, ["CreateAccount", "Transfer", "AddLimited"]); // the agent only gets a function-call key
  assert.deepEqual(sent[2].types, ["CreateAccount", "Transfer", "Deploy", "Call"]); // deploy + init together
  assert.equal(dep.agentKeyScope.methods[0], "request_payment");
  const saved = fs.readFileSync(path.join(dir, "deployment.json"), "utf8");
  assert.ok(!saved.includes("priv"), "deployment.json must hold public data only");
  assert.ok(fs.existsSync(path.join(dir, ".keys/agent.alice-agents.testnet.json")));
  assert.equal(getStatus(dir).stage, "deployed");
});
test("a failed step stops the deploy and writes no deployment file", async () => {
  const { dir, deps } = fixture({ failStep: "agent." });
  await createOwner(deps, "alice-agents");
  await assert.rejects(() => deploySandbox(deps), /Creating the agent account failed/);
  assert.equal(fs.existsSync(path.join(dir, "deployment.json")), false);
});
test("a retry skips accounts that already exist", async () => {
  const { deps, sent } = fixture({ existing: ["guardian.alice-agents.testnet", "agent.alice-agents.testnet"] });
  await createOwner(deps, "alice-agents");
  await deploySandbox(deps);
  assert.deepEqual(sent.map((s) => s.receiverId), ["vault.alice-agents.testnet"]);
});
test("an existing vault is never overwritten", async () => {
  const { deps } = fixture({ existing: ["vault.alice-agents.testnet"] });
  await createOwner(deps, "alice-agents");
  await assert.rejects(() => deploySandbox(deps), /already exists/);
});
test("a missing contract file gives a clear error", async () => {
  const { deps } = fixture({ wasm: false });
  await createOwner(deps, "alice-agents");
  await assert.rejects(() => deploySandbox(deps), /contract file is missing/);
});
test("a deployment file copied from someone else does not count as deployed", () => {
  const { dir } = fixture();
  fs.writeFileSync(path.join(dir, "deployment.json"), JSON.stringify({ owner: "x.testnet", guardian: "guardian.x.testnet", vault: "vault.x.testnet", agent: "agent.x.testnet" }));
  assert.equal(getStatus(dir).stage, "no_owner");
});
