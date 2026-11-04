// AgentGuard policy: strict schema + deterministic checker.
// The LLM may only PROPOSE a policy (parsePolicy validates it).
// Allow / block / ask is decided here, by plain code, never by an LLM.

export type Verdict = "allow" | "block" | "ask";

export interface Policy {
  version: 1;
  per_tx_limit: string | null; // yoctoNEAR, null = no limit
  daily_limit: string | null; // yoctoNEAR per UTC day
  approval_threshold: string | null; // ask a human above this amount
  allowlist: string[];
  allowlist_only: boolean;
  blocklist: string[];
  risk_block_score: number; // 0-100: at or above => block
  risk_review_score: number; // 0-100: at or above => ask
}

export interface PaymentRequest {
  to: string;
  amount: string; // yoctoNEAR, digits only
}
export interface Context {
  spentToday: bigint;
  riskScore: number | null; // null = scam check unavailable
}
export interface Reason {
  code: string;
  verdict: Verdict;
  message: string;
}
export interface Decision {
  verdict: Verdict;
  reasons: Reason[];
}

const YOCTO = 10n ** 24n;
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const isAccountId = (s: unknown): s is string =>
  typeof s === "string" && s.length >= 2 && s.length <= 64 && ACCOUNT_RE.test(s);
const isAmount = (s: unknown): s is string =>
  typeof s === "string" && /^\d+$/.test(s);

export function fmtNear(yocto: bigint): string {
  const whole = yocto / YOCTO;
  const frac = (yocto % YOCTO).toString().padStart(24, "0").slice(0, 4);
  return `${whole}.${frac} NEAR`.replace(/\.?0+ NEAR$/, " NEAR").replace(/^(\d+) NEAR$/, "$1 NEAR");
}

const KEYS = [
  "version", "per_tx_limit", "daily_limit", "approval_threshold",
  "allowlist", "allowlist_only", "blocklist",
  "risk_block_score", "risk_review_score",
];

export function parsePolicy(
  input: unknown,
): { ok: true; policy: Policy } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["policy must be a JSON object"] };
  }
  const p = input as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) errors.push(`unknown field: ${k}`);
  for (const k of KEYS) if (!(k in p)) errors.push(`missing field: ${k}`);
  if (p.version !== 1) errors.push("version must be 1");

  for (const k of ["per_tx_limit", "daily_limit", "approval_threshold"]) {
    const v = p[k];
    if (v !== null && v !== undefined && !(isAmount(v) && BigInt(v) > 0n)) {
      errors.push(`${k} must be null or a positive integer string in yoctoNEAR`);
    }
  }
  for (const k of ["allowlist", "blocklist"]) {
    const v = p[k];
    if (v !== undefined && !(Array.isArray(v) && v.every(isAccountId))) {
      errors.push(`${k} must be an array of valid NEAR account ids`);
    }
  }
  if (p.allowlist_only !== undefined && typeof p.allowlist_only !== "boolean") {
    errors.push("allowlist_only must be boolean");
  }
  for (const k of ["risk_block_score", "risk_review_score"]) {
    const v = p[k];
    if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100)) {
      errors.push(`${k} must be an integer 0-100`);
    }
  }
  if (errors.length === 0) {
    if ((p.risk_review_score as number) > (p.risk_block_score as number)) {
      errors.push("risk_review_score must be <= risk_block_score");
    }
    if (
      p.approval_threshold != null && p.per_tx_limit != null &&
      BigInt(p.approval_threshold as string) > BigInt(p.per_tx_limit as string)
    ) {
      errors.push("approval_threshold must be <= per_tx_limit");
    }
    if (
      (p.allowlist as string[]).some((a) => (p.blocklist as string[]).includes(a))
    ) {
      errors.push("an account cannot be in both allowlist and blocklist");
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, policy: p as unknown as Policy };
}

export function evaluate(policy: Policy, req: PaymentRequest, ctx: Context): Decision {
  if (!isAccountId(req.to) || !isAmount(req.amount) || BigInt(req.amount) === 0n) {
    return {
      verdict: "block",
      reasons: [{ code: "REQUEST_INVALID", verdict: "block", message: "Invalid destination or amount." }],
    };
  }
  const amount = BigInt(req.amount);
  const reasons: Reason[] = [];
  const block = (code: string, message: string) => reasons.push({ code, verdict: "block", message });
  const ask = (code: string, message: string) => reasons.push({ code, verdict: "ask", message });

  if (policy.blocklist.includes(req.to)) block("DEST_BLOCKLISTED", `${req.to} is on the blocklist.`);
  if (policy.per_tx_limit !== null && amount > BigInt(policy.per_tx_limit)) {
    block("OVER_PER_TX_LIMIT", `${fmtNear(amount)} exceeds the per-transaction limit of ${fmtNear(BigInt(policy.per_tx_limit))}.`);
  }
  if (policy.daily_limit !== null && ctx.spentToday + amount > BigInt(policy.daily_limit)) {
    block("OVER_DAILY_LIMIT", `Spent today ${fmtNear(ctx.spentToday)} + ${fmtNear(amount)} exceeds the daily limit of ${fmtNear(BigInt(policy.daily_limit))}.`);
  }
  if (policy.allowlist_only && !policy.allowlist.includes(req.to)) {
    block("NOT_ALLOWLISTED", `${req.to} is not on the allowlist.`);
  }
  if (ctx.riskScore === null) {
    ask("RISK_UNAVAILABLE", "Scam check unavailable; failing safe to human approval.");
  } else if (ctx.riskScore >= policy.risk_block_score) {
    block("RISK_TOO_HIGH", `Risk score ${ctx.riskScore} is at or above the block level ${policy.risk_block_score}.`);
  } else if (ctx.riskScore >= policy.risk_review_score) {
    ask("RISK_REVIEW", `Risk score ${ctx.riskScore} needs review (threshold ${policy.risk_review_score}).`);
  }
  if (policy.approval_threshold !== null && amount > BigInt(policy.approval_threshold)) {
    ask("APPROVAL_REQUIRED", `${fmtNear(amount)} is above the approval threshold of ${fmtNear(BigInt(policy.approval_threshold))}.`);
  }

  if (reasons.some((r) => r.verdict === "block")) return { verdict: "block", reasons };
  if (reasons.some((r) => r.verdict === "ask")) return { verdict: "ask", reasons };
  return { verdict: "allow", reasons: [{ code: "WITHIN_POLICY", verdict: "allow", message: "All policy checks passed." }] };
}

// Sum of payments actually executed since 00:00 UTC of the day containing `now` (ms).
export function sumSpentToday(entries: { amount: string; ts: number }[], now: number): bigint {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return entries
    .filter((e) => e.ts >= start && e.ts <= now)
    .reduce((s, e) => s + BigInt(e.amount), 0n);
}
