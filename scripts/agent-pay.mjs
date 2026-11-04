// Ask the vault to pay, exactly like your AI agent would, and wait for the decision.
//   node scripts/agent-pay.mjs shop.testnet 0.5 "invoice 42"
// Optional: GUARD_DATA_DIR=<folder> if the sandbox lives outside this folder.
import * as near from "@fastnear/api";
import fs from "node:fs";
import path from "node:path";
import { createAgentClient } from "../src/agent/client.ts";

const [to, amount, ...memo] = process.argv.slice(2);
if (!to || !amount) {
  console.error('Usage: node scripts/agent-pay.mjs <to-account> <amount-in-NEAR> ["memo"]');
  process.exit(1);
}
const dir = process.env.GUARD_DATA_DIR ?? ".";
const dep = JSON.parse(fs.readFileSync(path.join(dir, "deployment.json"), "utf8"));
const key = JSON.parse(fs.readFileSync(path.join(dir, ".keys", `${dep.agent}.json`), "utf8"));
near.config({ networkId: "testnet" });

const agent = createAgentClient({
  vault: dep.vault,
  agent: dep.agent,
  privateKey: key.privateKey,
  near: {
    actions: near.actions,
    sendTx: ({ signerId, privateKey, receiverId, actions }) =>
      near.sendTx({ signerId, signer: near.utils.signerFromPrivateKey(privateKey), receiverId, actions, waitUntil: "FINAL", network: "testnet" }),
    view: ({ contractId, methodName, args }) => near.view({ contractId, methodName, args, network: "testnet" }),
  },
});
const result = await agent.pay({ to, amountNear: amount, memo: memo.join(" ") });
console.log(JSON.stringify(result, null, 2));
