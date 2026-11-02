// A simple AI agent that tries three payments through the vault.
// It only holds a function-call key limited to vault.request_payment.
// Usage: node scripts/agent-demo.mjs
import * as near from "@fastnear/api";
import fs from "node:fs";

const dep = JSON.parse(fs.readFileSync("deployment.json", "utf8"));
const key = JSON.parse(fs.readFileSync(`.keys/${dep.agent}.json`, "utf8"));
near.config({ networkId: "testnet" });
const signer = near.utils.signerFromPrivateKey(key.privateKey);
const Y = (n) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();

// A lookalike of the owner's account: the last two characters swapped (or the last one changed).
function lookalike(id) {
  const [name, ...rest] = id.split(".");
  const a = name.split("");
  const i = a.length - 1;
  if (a[i] === a[i - 1]) a[i] = a[i] === "x" ? "y" : "x";
  else [a[i - 1], a[i]] = [a[i], a[i - 1]];
  return [a.join(""), ...rest].join(".");
}

const SCENARIOS = [
  { label: "(a) legitimate payment", to: dep.owner, near: 0.5 },
  { label: "(b) over-limit payment", to: dep.owner, near: 2.5 },
  { label: "(c) suspicious lookalike address", to: lookalike(dep.owner), near: 1 },
  { label: "(d) large payment, needs a human", to: dep.owner, near: 1.7 },
];

for (const s of SCENARIOS) {
  const r = await near.sendTx({
    signerId: dep.agent, signer, receiverId: dep.vault, network: "testnet", waitUntil: "FINAL",
    actions: [near.actions.functionCall({
      methodName: "request_payment", args: { to: s.to, amount: Y(s.near), memo: s.label }, gas: "30 Tgas", deposit: "0",
    })],
  });
  const text = JSON.stringify(r);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  console.log(`${s.label}: ${s.near} NEAR -> ${s.to}\n    ${panic ? "REFUSED BY VAULT: " + panic[1].trim() : "request submitted"}`);
}
const reqs = await near.view({ contractId: dep.vault, methodName: "get_requests", args: { from_index: 0, limit: 50 }, network: "testnet" });
console.log("\nPending on chain:", reqs.filter((r) => r.status === "Pending").map((r) => r.id).join(", ") || "none");
