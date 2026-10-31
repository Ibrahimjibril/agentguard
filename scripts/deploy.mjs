// Deploys AgentGuard to NEAR testnet.
//   vault.<owner>    : contract only, NO access key (nobody can sign as the vault)
//   guardian.<owner> : full-access key held by the Guard service
//   agent.<owner>    : ONLY a function-call key limited to vault.request_payment
// Usage: node scripts/deploy.mjs OWNER.testnet
import * as near from "@fastnear/api";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const owner = process.argv[2];
if (!owner || !owner.endsWith(".testnet")) {
  console.error("Usage: node scripts/deploy.mjs OWNER.testnet");
  process.exit(1);
}
const vaultId = `vault.${owner}`;
const guardianId = `guardian.${owner}`;
const agentId = `agent.${owner}`;

// yoctoNEAR from a NEAR amount with up to 3 decimals
const Y = (n) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();

const keyFile = (id) => path.join(".keys", `${id}.json`);
if (!fs.existsSync(keyFile(owner))) {
  console.error(`Missing ${keyFile(owner)}. Run scripts/create-account.mjs first.`);
  process.exit(1);
}
const ownerKey = JSON.parse(fs.readFileSync(keyFile(owner), "utf8"));

function findWasm(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findWasm(p); if (r) return r; }
    else if (e.name.endsWith(".wasm")) return p;
  }
  return null;
}
const wasmPath = fs.existsSync("artifacts") ? findWasm("artifacts") : null;
if (!wasmPath) {
  console.error("No .wasm found in ./artifacts. Download it with gh run download first.");
  process.exit(1);
}
const wasm = fs.readFileSync(wasmPath);
console.log(`wasm: ${wasmPath} (${wasm.length} bytes)`);

near.config({ networkId: "testnet" });
const signer = near.utils.signerFromPrivateKey(ownerKey.privateKey);

// Make + save keys BEFORE sending anything, so a key can never be lost.
function makeKey(id) {
  const privateKey = near.utils.privateKeyFromRandom();
  const publicKey = near.utils.publicKeyFromPrivate(privateKey);
  fs.mkdirSync(".keys", { recursive: true });
  fs.writeFileSync(keyFile(id), JSON.stringify({ accountId: id, publicKey, privateKey }, null, 2), { mode: 0o600 });
  return publicKey;
}
const guardianPub = fs.existsSync(keyFile(guardianId)) ? JSON.parse(fs.readFileSync(keyFile(guardianId), "utf8")).publicKey : makeKey(guardianId);
const agentPub = fs.existsSync(keyFile(agentId)) ? JSON.parse(fs.readFileSync(keyFile(agentId), "utf8")).publicKey : makeKey(agentId);

const A = near.actions;
const send = async (label, receiverId, actions) => {
  const r = await near.sendTx({ signerId: owner, signer, receiverId, actions, waitUntil: "FINAL", network: "testnet" });
  const hash = r?.transaction?.hash ?? null;
  console.log(`OK  ${label}: ${receiverId}  tx=${hash}`);
  return hash;
};

const txs = {};
txs.guardian = await send("guardian", guardianId, [
  A.createAccount(), A.transfer(Y(1)), A.addFullAccessKey({ publicKey: guardianPub }),
]);
txs.agent = await send("agent", agentId, [
  A.createAccount(), A.transfer(Y(1)),
  A.addLimitedAccessKey({ publicKey: agentPub, allowance: Y(0.25), accountId: vaultId, methodNames: ["request_payment"] }),
]);
// Create + fund + deploy + init in ONE atomic transaction (no one can front-run init).
const HARD_PER_TX = Y(3), HARD_DAILY = Y(6);
txs.vault = await send("vault", vaultId, [
  A.createAccount(), A.transfer(Y(6)),
  A.deployContract({ codeBase64: wasm.toString("base64") }),
  A.functionCall({
    methodName: "new",
    args: { owner, guardian: guardianId, agent: agentId, hard_per_tx: HARD_PER_TX, hard_daily: HARD_DAILY },
    gas: "30 Tgas", deposit: "0",
  }),
]);

const info = {
  network: "testnet", owner, vault: vaultId, guardian: guardianId, agent: agentId,
  guardianPublicKey: guardianPub, agentPublicKey: agentPub,
  agentKeyScope: { receiver: vaultId, methods: ["request_payment"], allowanceNEAR: 0.25 },
  hardCaps: { perTxYocto: HARD_PER_TX, dailyYocto: HARD_DAILY },
  wasmSha256: crypto.createHash("sha256").update(wasm).digest("hex"),
  txs,
};
fs.writeFileSync("deployment.json", JSON.stringify(info, null, 2));
console.log("\nSaved deployment.json (public info only).");
const cfg = await near.view({ contractId: vaultId, methodName: "get_config", args: {}, network: "testnet" });
console.log("get_config:", JSON.stringify(cfg));
