// Reads the key permissions straight from the chain, then makes two attempts that
// only the NEAR protocol (not our code) can refuse. Usage: node scripts/prove-keys.mjs
import path from "node:path";
import * as near from "@fastnear/api";
import fs from "node:fs";

const DIR = process.env.GUARD_DATA_DIR ?? ".";
const dep = JSON.parse(fs.readFileSync(path.join(DIR, "deployment.json"), "utf8"));
const key = (id) => JSON.parse(fs.readFileSync(path.join(DIR, ".keys", `${id}.json`), "utf8"));
near.config({ networkId: "testnet" });
const A = near.actions;
const NEARS = (y) => Number(BigInt(y) / 10n ** 20n) / 1e4;
const agentSigner = near.utils.signerFromPrivateKey(key(dep.agent).privateKey);

console.log("--- Keys as stored ON CHAIN ---");
for (const [name, id] of [["vault", dep.vault], ["agent", dep.agent], ["guardian", dep.guardian]]) {
  const r = await near.queryAccessKeyList({ accountId: id, blockId: "final", network: "testnet" });
  const keys = r.result.keys;
  console.log(`${name}: ${keys.length} key(s)`);
  for (const k of keys) {
    const p = k.access_key.permission;
    console.log("   ", typeof p === "string" ? p : JSON.stringify(p));
  }
}

const KNOWN = ["RequiresFullAccess", "DepositWithFunctionCall", "MethodNameMismatch", "ReceiverMismatch", "NotEnoughAllowance"];
async function attempt(label, actions) {
  let text;
  try {
    const r = await near.sendTx({ signerId: dep.agent, signer: agentSigner, receiverId: dep.vault, actions, waitUntil: "FINAL", network: "testnet" });
    text = JSON.stringify(r);
    if (!KNOWN.some((k) => text.includes(k)) && !text.includes("Failure")) { console.log(`ALLOWED  ${label}`); return; }
  } catch (e) {
    text = String(e?.message ?? e) + " " + JSON.stringify(e?.data ?? "");
  }
  const k = KNOWN.find((x) => text.includes(x));
  console.log(`BLOCKED  ${label}\n         -> ${k ? "network says: " + k : text.slice(0, 160)}`);
}
console.log("\n--- Attempts only the NEAR protocol can refuse ---");
await attempt("agent sends a plain transfer (0.1 NEAR) to the vault", [A.transfer((10n ** 23n).toString())]);
await attempt("agent attaches money to request_payment", [
  A.functionCall({ methodName: "request_payment", args: { to: dep.owner, amount: "1", memo: "x" }, gas: "30 Tgas", deposit: "1" }),
]);

console.log("\n--- Balances (did the vault really pay?) ---");
for (const [name, id] of [["owner", dep.owner], ["vault", dep.vault]]) {
  const a = await near.queryAccount({ accountId: id, network: "testnet" });
  console.log(`${name}: ${NEARS(a.result.amount)} NEAR`);
}
