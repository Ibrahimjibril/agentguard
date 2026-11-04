// Talks to the local Guard API (scripts/serve.ts). Nothing secret ever reaches the browser.
export type Verdict = "allow" | "block" | "ask";
export type Status = "paid" | "rejected" | "awaiting_approval" | "human_rejected" | "error";

export interface Reason { code: string; verdict: Verdict; message: string }
export interface Decision {
  id: number;
  to: string;
  amount: string;
  amountNear: string;
  memo: string;
  verdict: Verdict;
  status: Status;
  reasons: Reason[];
  risk: { score: number | null; reasons: string[] };
  tx: string | null;
  ts: number;
  updated: number;
}
export interface VaultInfo {
  vault: string;
  agent: string;
  guardian: string;
  owner: string;
  hardPerTx: string;
  hardDaily: string;
  hardPerTxNear: number;
  hardDailyNear: number;
  spentTodayNear: number;
  balanceNear: number;
  pendingOnChain: number;
  totalRequests: number;
}
export type PolicyJson = Record<string, unknown>;
export interface PolicyView { json: PolicyJson; summary: string[]; warnings: string[] }
export interface Snapshot { capturedAt: number; network: string; vault: string; repo: string }
export interface State {
  snapshot?: Snapshot;
  policy: PolicyView | null;
  decisions: Decision[];
  awaiting: number;
  vault: VaultInfo | null;
  llmConfigured: boolean;
}
export interface Draft { policy: PolicyJson; summary: string[]; warnings: string[]; attempts: number }

export const API_BASE: string = process.env.NEXT_PUBLIC_GUARD_API ?? "http://localhost:8787";
// When set (for the public Vercel site), the dashboard replays a recorded run of the
// real testnet Guard instead of talking to a local one. Nothing can be changed in this mode.
export const DEMO_SNAPSHOT: string = process.env.NEXT_PUBLIC_DEMO_SNAPSHOT ?? "";
export const isDemo: boolean = DEMO_SNAPSHOT !== "";
const DEMO_MSG = "This is a recorded demo. Run AgentGuard locally to approve payments and write rules.";

interface Reply { status: number; body: any }

async function request(path: string, method: "GET" | "POST" = "GET", payload?: unknown): Promise<Reply> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });
  let body: any = {};
  try { body = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body };
}

export async function getState(): Promise<State> {
  if (isDemo) {
    const res = await fetch(DEMO_SNAPSHOT, { cache: "no-store" });
    if (!res.ok) throw new Error("Demo snapshot not found");
    return (await res.json()) as State;
  }
  const r = await request("/api/state");
  if (r.status !== 200) throw new Error(r.body?.error ?? `Guard answered ${r.status}`);
  return r.body as State;
}

// Result shapes use optional fields (not unions) so they type-check the same in strict and non-strict builds.
export interface DraftResult { ok: boolean; draft?: Draft; error?: string }
export interface ActivateResult { ok: boolean; needsConfirmation?: boolean; error?: string }

export async function draftRules(text: string): Promise<DraftResult> {
  if (isDemo) return { ok: false, error: DEMO_MSG };
  const r = await request("/api/policy/compile", "POST", { text });
  if (r.status === 200 && r.body?.ok) return { ok: true, draft: r.body as Draft };
  const detail = Array.isArray(r.body?.errors) ? r.body.errors.join("; ") : r.body?.error;
  return { ok: false, error: detail ?? "Could not draft rules." };
}

export async function activateRules(policy: PolicyJson, confirmUnlimited: boolean): Promise<ActivateResult> {
  if (isDemo) return { ok: false, needsConfirmation: false, error: DEMO_MSG };
  const r = await request("/api/policy/activate", "POST", { policy, confirmUnlimited });
  if (r.status === 200) return { ok: true };
  if (r.status === 409 && r.body?.needsConfirmation) {
    return { ok: false, needsConfirmation: true, error: (r.body.warnings ?? []).join(" ") };
  }
  const detail = Array.isArray(r.body?.errors) ? r.body.errors.join("; ") : r.body?.error;
  return { ok: false, needsConfirmation: false, error: detail ?? "Could not activate rules." };
}

export async function decide(id: number, approve: boolean): Promise<{ ok: boolean; error?: string }> {
  if (isDemo) return { ok: false, error: DEMO_MSG };
  const r = await request(`/api/decisions/${id}/${approve ? "approve" : "reject"}`, "POST", {});
  return r.status === 200 ? { ok: true } : { ok: false, error: r.body?.error ?? "Request failed." };
}

// ---- sandbox setup (the dashboard creates the accounts for you) ----
export type Stage = "no_owner" | "owner_ready" | "deployed";
export interface SetupStatus {
  ok: boolean;
  stage: Stage;
  owner?: string;
  vault?: string;
  agent?: string;
  guardian?: string;
  agentKeyFile?: string;
  llmConfigured?: boolean;
}

export async function getSetup(): Promise<SetupStatus> {
  if (isDemo) return { ok: true, stage: "deployed" };
  const r = await request("/api/setup");
  if (r.status !== 200) throw new Error(r.body?.error ?? `Guard answered ${r.status}`);
  return r.body as SetupStatus;
}

export async function createOwner(name: string): Promise<{ ok: boolean; owner?: string; error?: string }> {
  const r = await request("/api/setup/owner", "POST", { name });
  return r.status === 200 ? { ok: true, owner: r.body.owner } : { ok: false, error: r.body?.error ?? "Could not create the account." };
}

export async function deploySandbox(): Promise<{ ok: boolean; error?: string }> {
  const r = await request("/api/setup/deploy", "POST", {});
  return r.status === 200 ? { ok: true } : { ok: false, error: r.body?.error ?? "Could not create the sandbox." };
}
