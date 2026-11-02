// Creates a funded NEAR testnet account (free faucet) and saves its key in .keys/ (never committed).
// Usage: node scripts/create-account.mjs NAME.testnet
import * as near from "@fastnear/api";
import fs from "node:fs";

const accountId = process.argv[2];
if (!accountId || !accountId.endsWith(".testnet")) {
  console.error("Usage: node scripts/create-account.mjs NAME.testnet");
  process.exit(1);
}
near.config({ networkId: "testnet" });
const privateKey = near.utils.privateKeyFromRandom();
const publicKey = near.utils.publicKeyFromPrivate(privateKey);

// Save the key BEFORE the network call, so a key can never be lost.
fs.mkdirSync(".keys", { recursive: true });
fs.writeFileSync(
  `.keys/${accountId}.json`,
  JSON.stringify({ accountId, publicKey, privateKey }, null, 2),
  { mode: 0o600 }
);

const result = await near.createFundedTestnetAccount({
  newAccountId: accountId,
  publicKey,
});
console.log("Account created:", accountId);
console.log("Public key:", publicKey);
console.log("Result:", JSON.stringify(result));
