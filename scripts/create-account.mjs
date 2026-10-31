import * as near from "@fastnear/api";
import fs from "node:fs";

const accountId = process.argv[2];
if (!accountId || !accountId.endsWith(".testnet")) {
  console.error("Amfani: node scripts/create-account.mjs SUNA.testnet");
  process.exit(1);
}
near.config({ networkId: "testnet" });
const privateKey = near.utils.privateKeyFromRandom();
const publicKey = near.utils.publicKeyFromPrivate(privateKey);

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
console.log("An ƙirƙiri asusu:", accountId);
console.log("Public key:", publicKey);
console.log("Sakamako:", JSON.stringify(result));
