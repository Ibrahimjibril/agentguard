// Optional: auto-approve only while the agent holds a valid Clearance certificate.
// Clearance (https://github.com/Selliksss/clearance) crash-tests agents that pay and
// records a revocable certificate on NEAR. With clearance.json in GUARD_DATA_DIR, the Guard
// reads is_certified(agent, signer, level) on chain before it auto-approves a payment;
// if the certificate is missing, expired or revoked, or the read fails, a human decides.
// It never turns an "ask" or "block" into an "allow".
import * as near from "@fastnear/api";
import { isAccountId } from "../policy/policy.ts";

export interface ClearanceConfig {
  contract: string; // the Clearance registry, e.g. clearance-dev.testnet
  agent: string; // the agent's certified account
  signer: string; // whose certificate counts, e.g. Clearance's CI signer
  level: 1 | 2; // the lowest level that may auto-approve
  network?: "testnet" | "mainnet";
}

export function parseClearance(input: unknown): { ok: true; config: ClearanceConfig } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["clearance config must be a JSON object"] };
  const c = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(c)) if (!["contract", "agent", "signer", "level", "network"].includes(k)) errors.push(`unknown field: ${k}`);
  for (const k of ["contract", "agent", "signer"]) if (!isAccountId(c[k])) errors.push(`${k} must be a NEAR account id`);
  if (c.level !== 1 && c.level !== 2) errors.push("level must be 1 or 2");
  if (c.network !== undefined && c.network !== "testnet" && c.network !== "mainnet") errors.push("network must be testnet or mainnet");
  return errors.length ? { ok: false, errors } : { ok: true, config: c as unknown as ClearanceConfig };
}

// true = certified now; false = not certified (missing, expired, revoked, lower level); null = could not read.
// A read that takes longer than timeoutMs counts as failed (null), so a hung RPC cannot stall the Guard.
export function clearanceReader(cfg: ClearanceConfig, timeoutMs = 10_000): () => Promise<boolean | null> {
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = near.view({
        contractId: cfg.contract, methodName: "is_certified",
        args: { agent: cfg.agent, signer: cfg.signer, level: cfg.level }, network: cfg.network ?? "testnet",
      });
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
      const r = await Promise.race([read, timeout]);
      return typeof r === "boolean" ? r : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
