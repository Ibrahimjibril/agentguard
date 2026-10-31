// Real chain adapter: talks to the AgentGuard vault on NEAR testnet as the guardian.
import * as near from "@fastnear/api";
import fs from "node:fs";
import type { Chain, ChainResult, PendingReq } from "./guard.ts";

export function nearChain(dep: any, guardianPrivateKey: string): Chain {
  const signer = near.utils.signerFromPrivateKey(guardianPrivateKey);
  near.config({ networkId: "testnet" });
  const call = async (methodName: string, id: number): Promise<ChainResult> => {
    try {
      const r: any = await near.sendTx({
        signerId: dep.guardian, signer, receiverId: dep.vault, network: "testnet", waitUntil: "FINAL",
        actions: [near.actions.functionCall({ methodName, args: { id }, gas: "50 Tgas", deposit: "0" })],
      });
      const text = JSON.stringify(r);
      const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
      const failed = panic || /"Failure"/.test(text);
      return { ok: !failed, tx: r?.transaction?.hash ?? r?.transaction_outcome?.id ?? null, error: failed ? (panic?.[1]?.trim() ?? "transaction failed") : null };
    } catch (e: any) {
      return { ok: false, tx: null, error: String(e?.message ?? e).slice(0, 200) };
    }
  };
  return {
    async listPending(): Promise<PendingReq[]> {
      const out: PendingReq[] = [];
      for (let from = 0; ; from += 50) {
        const page: any[] = await near.view({ contractId: dep.vault, methodName: "get_requests", args: { from_index: from, limit: 50 }, network: "testnet" });
        for (const p of page) if (p.status === "Pending") out.push({ id: Number(p.id), to: p.to, amount: String(p.amount), memo: p.memo });
        if (page.length < 50) break;
      }
      return out;
    },
    approve: (id) => call("approve", id),
    reject: (id) => call("reject", id),
    async accountExists(id) {
      try {
        const r: any = await near.queryAccount({ accountId: id, network: "testnet" });
        const err = r?.result?.error ?? r?.error;
        if (err) return /does not exist|UNKNOWN_ACCOUNT/i.test(JSON.stringify(err)) ? false : null;
        return true;
      } catch (e: any) {
        return /does not exist|UNKNOWN_ACCOUNT/i.test(String(e?.message ?? e)) ? false : null;
      }
    },
  };
}
export const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
