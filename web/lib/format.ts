import type { Status } from "./api";

export function nearFmt(n: number): string {
  const s = n.toFixed(4).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}

// yoctoNEAR string -> NEAR number (display only; the Guard does the exact maths)
export function yoctoToNear(y: unknown): number | null {
  if (typeof y !== "string") return null;
  const n = Number(y) / 1e24;
  return Number.isFinite(n) ? n : null;
}

export function timeAgo(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function shortAccount(a: string): string {
  return a.length > 30 ? `${a.slice(0, 14)}…${a.slice(-10)}` : a;
}

const TITLES: Record<string, string> = {
  WITHIN_POLICY: "Within your rules",
  OVER_PER_TX_LIMIT: "Over the per-payment limit",
  OVER_DAILY_LIMIT: "Over the daily limit",
  NOT_ALLOWLISTED: "Not on your trusted list",
  DEST_BLOCKLISTED: "On your blocklist",
  RISK_TOO_HIGH: "Looks like a scam",
  RISK_REVIEW: "Needs a second look",
  RISK_UNAVAILABLE: "Could not check the address",
  APPROVAL_REQUIRED: "Big payment: needs your OK",
  NO_POLICY: "No rules set yet",
  HUMAN_APPROVED: "You approved it",
  HUMAN_REJECTED: "You declined it",
  CHAIN_ERROR: "The vault reported an error",
  REQUEST_INVALID: "Invalid request",
};
export const reasonTitle = (code: string): string => TITLES[code] ?? code;

export type Tone = "allow" | "block" | "ask" | "warn";
export function statusView(s: Status): { label: string; tone: Tone } {
  switch (s) {
    case "paid": return { label: "Paid", tone: "allow" };
    case "rejected": return { label: "Blocked", tone: "block" };
    case "awaiting_approval": return { label: "Waiting for you", tone: "ask" };
    case "human_rejected": return { label: "You declined", tone: "block" };
    default: return { label: "Error", tone: "warn" };
  }
}
