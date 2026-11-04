// Proves the agent's sandbox on testnet:
//  - the agent key CANNOT transfer NEAR, CANNOT approve its own request, CANNOT call other contracts
//  - it CAN ask the vault for a payment, and the vault's on-chain hard cap still applies
//  - only the guardian can approve, and then the vault pays
// Usage: node scripts/prove-sandbox.mjs
import path from "node:path";
import * as near from "@fastnear/api";
import fs from "node:fs";

const DIR = process.env.GUARD_DATA_DIR ?? ".";
const dep = JSON.parse(fs.readFileSync(path.join(DIR, "deployment.json"), "utf8"));
const key = (id) => JSON.parse(fs.readFileSync(path.join(DIR, ".keys", `${id}.json`), "utf8"));
near.config({ networkId: "testnet" });
const A = near.actions;
const Y = (n) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const agentSigner = near.utils.signerFromPrivateKey(key(dep.agent).privateKey);
const guardianSigner = near.utils.signerFromPrivateKey(key(dep.guardian).privateKey);

const send = (signerId, signer, receiverId, actions) =>
  near.sendTx({ signerId, signer, receiverId, actions, waitUntil: "FINAL", network: "testnet" });

const KNOWN = ["RequiresFullAccess", "MethodNameMismatch", "ReceiverMismatch", "DepositWithFunctionCall", "NotEnoughAllowance"];
function reason(text) {
  const p = text.match(/Smart contract panicked: ([^"\\]+)/);
  if (p) return `contract says: ${p[1].trim()}`;
  const k = KNOWN.find((x) => text.includes(x));
  return k ? `network says: ${k}` : null;
}
async function attempt(label, fn) {
  try {
    const r = await fn();
    const why = reason(JSON.stringify(r));
    if (why) console.log(`BLOCKED  ${label}\n         -> ${why}`);
    else console.log(`ALLOWED  ${label}`);
    return r;
  } catch (e) {
    const msg = String(e?.message ?? e) + " " + JSON.stringify(e?.data ?? "");
    console.log(`BLOCKED  ${label}\n         -> ${reason(msg) ?? msg.slice(0, 160)}`);
    return null;
  }
}
const getReqs = () => near.view({ contractId: dep.vault, methodName: "get_requests", args: { from_index: 0, limit: 10 }, network: "testnet" });
const reqCall = (to, amount) =>
  A.functionCall({ methodName: "request_payment", args: { to, amount, memo: "demo" }, gas: "30 Tgas", deposit: "0" });

console.log("--- Agent tries things it must NOT be able to do ---");
await attempt("agent transfers 0.1 NEAR directly", () => send(dep.agent, agentSigner, dep.owner, [A.transfer(Y(0.1))]));
await attempt("agent calls vault.approve on its own request", () =>
  send(dep.agent, agentSigner, dep.vault, [A.functionCall({ methodName: "approve", args: { id: 0 }, gas: "30 Tgas", deposit: "0" })]));
await attempt("agent calls request_payment on a different account", () => send(dep.agent, agentSigner, dep.owner, [reqCall(dep.owner, Y(1))]));
await attempt("agent requests 4 NEAR (hard cap is 3)", () => send(dep.agent, agentSigner, dep.vault, [reqCall(dep.owner, Y(4))]));

console.log("\n--- Agent does what it IS allowed to do ---");
await attempt("agent requests 1 NEAR", () => send(dep.agent, agentSigner, dep.vault, [reqCall(dep.owner, Y(1))]));
let reqs = await getReqs();
console.log("requests on chain:", JSON.stringify(reqs.map((r) => ({ id: r.id, to: r.to, status: r.status }))));

const id = reqs.length ? reqs[reqs.length - 1].id : 0;
console.log("\n--- Only the guardian can approve ---");
await attempt(`guardian approves request ${id}`, () =>
  send(dep.guardian, guardianSigner, dep.vault, [A.functionCall({ methodName: "approve", args: { id }, gas: "50 Tgas", deposit: "0" })]));
reqs = await getReqs();
console.log("requests on chain:", JSON.stringify(reqs.map((r) => ({ id: r.id, status: r.status }))));
const cfg = await near.view({ contractId: dep.vault, methodName: "get_config", args: {}, network: "testnet" });
console.log("spent_today (yocto):", cfg.spent_today);
