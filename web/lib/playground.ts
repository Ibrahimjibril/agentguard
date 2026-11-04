import { parsePolicy, evaluate, isAccountId, fmtNear } from "./core/policy";
import { scoreDestination } from "./core/scam";
import knownBadRaw from "./core/known-bad.json";

export const DEMO_OWNER = "jibsonfta.testnet";
export const VAULT = "vault.jibsonfta.testnet";
export const AGENT = "agent.jibsonfta.testnet";
const YOCTO = 10n ** 24n;
const RPCS = ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];

function collect(x: unknown): string[] {
  if (typeof x === "string") return [x];
  if (Array.isArray(x)) return x.flatMap(collect);
  if (x && typeof x === "object") {
    return Object.entries(x as Record<string, unknown>).flatMap(([k, v]) => [k, ...collect(v)]);
  }
  return [];
}
const KNOWN_BAD: string[] = Array.from(new Set(collect(knownBadRaw))).filter(isAccountId);

export function nearToYocto(s: string): bigint | null {
  const m = /^(\d{1,9})(?:\.(\d{1,24}))?$/.exec(s.trim());
  if (!m) return null;
  return BigInt(m[1]) * YOCTO + BigInt((m[2] ?? "").padEnd(24, "0"));
}

async function rpc(method: string, params: unknown): Promise<any | null> {
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "ag", method, params }),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      const j: any = await res.json();
      if (j?.result) return j;
      if (j?.error && /UnknownAccount|UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j.error))) return j;
    } catch { /* try next endpoint */ }
  }
  return null;
}

async function accountExists(id: string): Promise<boolean | null> {
  const j = await rpc("query", { request_type: "view_account", finality: "final", account_id: id });
  if (!j) return null;
  const err = j.result?.error ?? j.error;
  if (err) return /does not exist|UNKNOWN_ACCOUNT|UnknownAccount/i.test(JSON.stringify(err)) ? false : null;
  return true;
}

export async function accessKeys(accountId: string) {
  const j = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: accountId });
  if (!j?.result?.keys) return null;
  return j.result.keys.map((k: any) => {
    const p = k.access_key?.permission;
    return p === "FullAccess"
      ? { key: k.public_key, kind: "FullAccess" }
      : { key: k.public_key, kind: "FunctionCall", receiver: p?.FunctionCall?.receiver_id, methods: p?.FunctionCall?.method_names };
  });
}

const LABELS: Record<string, string> = {
  perTxNear: "Per-payment limit",
  dailyNear: "Daily limit",
  approvalNear: "Approval threshold",
};

export async function runCheck(body: any): Promise<{ status: number; json: any }> {
  const to = String(body?.to ?? "").trim().toLowerCase();
  if (!isAccountId(to)) return { status: 400, json: { ok: false, error: "Enter a valid NEAR account, for example shop.testnet." } };
  const amount = nearToYocto(String(body?.amountNear ?? ""));
  if (amount === null || amount === 0n) return { status: 400, json: { ok: false, error: "Amount must be a positive number of NEAR." } };

  const lim: Record<string, string | null> = {};
  for (const k of ["perTxNear", "dailyNear", "approvalNear"]) {
    const raw = String(body?.[k] ?? "").trim();
    if (raw === "") { lim[k] = null; continue; }
    const y = nearToYocto(raw);
    if (y === null || y === 0n) return { status: 400, json: { ok: false, error: `${LABELS[k]} must be empty (no limit) or a positive number.` } };
    lim[k] = y.toString();
  }

  const parsed = parsePolicy({
    version: 1,
    per_tx_limit: lim.perTxNear,
    daily_limit: lim.dailyNear,
    approval_threshold: lim.approvalNear,
    allowlist: [],
    allowlist_only: false,
    blocklist: [],
    risk_block_score: 70,
    risk_review_score: 40,
  });
  if (!parsed.ok) return { status: 400, json: { ok: false, error: parsed.errors.join("; ") } };
  const policy = parsed.policy;

  const spentToday = nearToYocto(String(body?.spentTodayNear ?? "0")) ?? 0n;
  const trusted = Array.from(new Set([DEMO_OWNER, ...policy.allowlist]));
  const known = trusted.includes(to) || KNOWN_BAD.includes(to);
  const exists = known ? true : await accountExists(to);
  const risk = scoreDestination(to, { exists }, { trusted, knownBad: KNOWN_BAD });
  const decision = evaluate(policy, { to, amount: amount.toString() }, { spentToday, riskScore: risk.score });

  return { status: 200, json: { ok: true, verdict: decision.verdict, reasons: decision.reasons, risk, to, amountNear: fmtNear(amount) } };
}
