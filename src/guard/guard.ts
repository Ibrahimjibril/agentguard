// Guard core: for every pending payment request, run policy + scam check,
// decide allow / block / ask, act on the vault, and log the reason.
// The decision is made by deterministic code (policy.ts, scam.ts). No LLM here.
import { evaluate, sumSpentToday } from "../policy/policy.ts";
import type { Decision } from "../policy/policy.ts";
import { scoreDestination } from "./scam.ts";
import type { Risk } from "./scam.ts";
import type { Store, Status } from "./store.ts";

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000; // identical payments inside this window go to a human

export interface PendingReq { id: number; to: string; amount: string; memo: string }
export interface ChainResult { ok: boolean; tx: string | null; error: string | null }
export interface Chain {
  listPending(): Promise<PendingReq[]>;
  approve(id: number): Promise<ChainResult>;
  reject(id: number): Promise<ChainResult>;
  accountExists(id: string): Promise<boolean | null>;
}
export interface Deps {
  store: Store;
  chain: Chain;
  trusted: string[]; // always-trusted accounts (e.g. the owner)
  knownBad: string[];
  now?: () => number;
}

export interface Outcome { id: number; verdict: string; status: Status; reasons: string[]; risk: Risk }

export async function processRequest(d: Deps, r: PendingReq): Promise<Outcome | null> {
  if (d.store.getDecision(r.id)) return null; // already handled
  const now = d.now?.() ?? Date.now();
  const policy = d.store.getPolicy();
  const trusted = [...new Set([...(policy?.allowlist ?? []), ...d.trusted])];
  const exists = await d.chain.accountExists(r.to).catch(() => null);
  const risk = scoreDestination(r.to, { exists }, { trusted, knownBad: d.knownBad });

  let decision: Decision = policy
    ? evaluate(policy, { to: r.to, amount: r.amount }, { spentToday: sumSpentToday(d.store.paidEntries(), now), riskScore: risk.score })
    : { verdict: "ask", reasons: [{ code: "NO_POLICY", verdict: "ask", message: "No active policy; human approval required." }] };

  // A retried request becomes a new id on the vault. If an identical payment (same
  // destination, amount and memo) was paid or queued moments ago, ask a human.
  if (decision.verdict === "allow") {
    const dup = d.store.recentSame(r.to, r.amount, r.memo, r.id, now - DUPLICATE_WINDOW_MS);
    if (dup) {
      decision = {
        verdict: "ask",
        reasons: [{
          code: "DUPLICATE_RECENT", verdict: "ask",
          message: "Same payment (request #" + dup.request_id + ") was " + (dup.status === "paid" ? "paid" : "queued") + " less than 10 minutes ago. A retry or a second purchase?",
        }],
      };
    }
  }

  let status: Status;
  let tx: string | null = null;
  const reasons = [...decision.reasons];
  if (decision.verdict === "allow") {
    const res = await d.chain.approve(r.id);
    status = res.ok ? "paid" : "error"; tx = res.tx;
    if (!res.ok) reasons.push({ code: "CHAIN_ERROR", verdict: "block", message: `Vault approve failed: ${res.error}` });
  } else if (decision.verdict === "block") {
    const res = await d.chain.reject(r.id);
    status = res.ok ? "rejected" : "error"; tx = res.tx;
    if (!res.ok) reasons.push({ code: "CHAIN_ERROR", verdict: "block", message: `Vault reject failed: ${res.error}` });
  } else {
    status = "awaiting_approval";
  }
  d.store.saveDecision({ request_id: r.id, ts: now, to: r.to, amount: r.amount, memo: r.memo, verdict: decision.verdict, status, reasons, risk, tx }, now);
  return { id: r.id, verdict: decision.verdict, status, reasons: reasons.map((x) => `${x.code}: ${x.message}`), risk };
}

export async function processAll(d: Deps): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const r of await d.chain.listPending()) {
    const o = await processRequest(d, r);
    if (o) out.push(o);
  }
  return out;
}

// A human resolves a request that is awaiting approval.
export async function humanDecide(d: Deps, id: number, approve: boolean): Promise<Status> {
  const row = d.store.getDecision(id);
  if (!row) throw new Error(`unknown request ${id}`);
  if (row.status !== "awaiting_approval") throw new Error(`request ${id} is ${row.status}, not awaiting approval`);
  const res = approve ? await d.chain.approve(id) : await d.chain.reject(id);
  const status: Status = res.ok ? (approve ? "paid" : "human_rejected") : "error";
  const code = approve ? "HUMAN_APPROVED" : "HUMAN_REJECTED";
  const extra = res.ok
    ? { code, verdict: approve ? "allow" as const : "block" as const, message: approve ? "Approved by a human." : "Rejected by a human." }
    : { code: "CHAIN_ERROR", verdict: "block" as const, message: `Vault call failed: ${res.error}` };
  d.store.updateDecision(id, status, res.tx, [...row.reasons, extra], d.now?.() ?? Date.now());
  return status;
}
