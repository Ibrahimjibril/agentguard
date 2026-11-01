// Reads the vault's on-chain state for the dashboard (cached for 5 seconds).
import * as near from "@fastnear/api";
import { fmtNear } from "../policy/policy.ts";

export function vaultInfoReader(dep: any) {
  let cache: { at: number; value: unknown } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < 5000) return cache.value;
    const cfg: any = await near.view({ contractId: dep.vault, methodName: "get_config", args: {}, network: "testnet" });
    const acc: any = await near.queryAccount({ accountId: dep.vault, network: "testnet" });
    const near4 = (y: string) => Number(BigInt(y) / 10n ** 20n) / 1e4;
    const value = {
      vault: dep.vault, agent: cfg.agent, guardian: cfg.guardian, owner: cfg.owner,
      hardPerTx: fmtNear(BigInt(cfg.hard_per_tx)), hardDaily: fmtNear(BigInt(cfg.hard_daily)),
      hardPerTxNear: near4(cfg.hard_per_tx), hardDailyNear: near4(cfg.hard_daily),
      spentTodayNear: near4(cfg.spent_today), balanceNear: near4(acc.result.amount),
      pendingOnChain: cfg.pending_count, totalRequests: cfg.total_requests,
    };
    cache = { at: Date.now(), value };
    return value;
  };
}
