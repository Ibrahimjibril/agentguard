// The real NEAR operations behind setup, using @fastnear/api on testnet.
import * as near from "@fastnear/api";
import type { NearOps } from "./setup.ts";

export function realOps(): NearOps {
  near.config({ networkId: "testnet" });
  return {
    actions: near.actions as any,
    newKeyPair() {
      const privateKey = near.utils.privateKeyFromRandom();
      return { privateKey, publicKey: near.utils.publicKeyFromPrivate(privateKey) };
    },
    createFundedAccount: (accountId, publicKey) => near.createFundedTestnetAccount({ newAccountId: accountId, publicKey }),
    sendTx: ({ signerId, privateKey, receiverId, actions }) =>
      near.sendTx({ signerId, signer: near.utils.signerFromPrivateKey(privateKey), receiverId, actions: actions as any, waitUntil: "FINAL", network: "testnet" }),
    async accountExists(accountId) {
      try {
        const r: any = await near.queryAccount({ accountId, network: "testnet" });
        const err = r?.result?.error ?? r?.error;
        if (err) return /does not exist|UNKNOWN_ACCOUNT/i.test(JSON.stringify(err)) ? false : null;
        return true;
      } catch (e: any) {
        return /does not exist|UNKNOWN_ACCOUNT/i.test(String(e?.message ?? e)) ? false : null;
      }
    },
  };
}
