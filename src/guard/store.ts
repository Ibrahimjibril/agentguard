// SQLite store (node:sqlite, no native dependencies): active policy + decision log.
import { DatabaseSync } from "node:sqlite";
import { parsePolicy } from "../policy/policy.ts";
import type { Policy, Reason, Verdict } from "../policy/policy.ts";

export type Status = "paid" | "rejected" | "awaiting_approval" | "human_rejected" | "error";
export interface DecisionInput {
  request_id: number;
  ts: number;
  to: string;
  amount: string; // yoctoNEAR
  memo: string;
  verdict: Verdict;
  status: Status;
  reasons: Reason[];
  risk: { score: number | null; reasons: string[] };
  tx: string | null;
}
export interface DecisionRow extends DecisionInput { updated: number }

export function openStore(file = "guard.db") {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS policies (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, json TEXT NOT NULL, source TEXT);
    CREATE TABLE IF NOT EXISTS decisions (
      request_id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, to_account TEXT NOT NULL, amount TEXT NOT NULL,
      memo TEXT NOT NULL, verdict TEXT NOT NULL, status TEXT NOT NULL, reasons TEXT NOT NULL,
      risk TEXT NOT NULL, tx TEXT, updated INTEGER NOT NULL);`);
  const toRow = (r: any): DecisionRow => ({
    request_id: Number(r.request_id), ts: Number(r.ts), to: r.to_account, amount: r.amount, memo: r.memo,
    verdict: r.verdict, status: r.status, reasons: JSON.parse(r.reasons), risk: JSON.parse(r.risk),
    tx: r.tx ?? null, updated: Number(r.updated),
  });
  return {
    setPolicy(policy: Policy, source = "manual", now = Date.now()) {
      const p = parsePolicy(policy);
      if (!p.ok) throw new Error("invalid policy: " + p.errors.join("; "));
      db.prepare("INSERT INTO policies (ts, json, source) VALUES (?, ?, ?)").run(now, JSON.stringify(p.policy), source);
    },
    getPolicy(): Policy | null {
      const r: any = db.prepare("SELECT json FROM policies ORDER BY id DESC LIMIT 1").get();
      if (!r) return null;
      const p = parsePolicy(JSON.parse(r.json));
      return p.ok ? p.policy : null; // a corrupted policy counts as "no policy" -> ask a human
    },
    getDecision(id: number): DecisionRow | null {
      const r = db.prepare("SELECT * FROM decisions WHERE request_id = ?").get(id);
      return r ? toRow(r) : null;
    },
    saveDecision(d: DecisionInput, now = Date.now()) {
      db.prepare(`INSERT INTO decisions (request_id, ts, to_account, amount, memo, verdict, status, reasons, risk, tx, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        d.request_id, d.ts, d.to, d.amount, d.memo, d.verdict, d.status,
        JSON.stringify(d.reasons), JSON.stringify(d.risk), d.tx, now);
    },
    updateDecision(id: number, status: Status, tx: string | null, reasons: Reason[], now = Date.now()) {
      db.prepare("UPDATE decisions SET status = ?, tx = ?, reasons = ?, updated = ? WHERE request_id = ?")
        .run(status, tx, JSON.stringify(reasons), now, id);
    },
    recentSame(to: string, amount: string, memo: string, excludeId: number, since: number): DecisionRow | null {
      const r = db.prepare(
        "SELECT * FROM decisions WHERE to_account = ? AND amount = ? AND memo = ? AND request_id != ? AND ts >= ? AND status IN ('paid', 'awaiting_approval') ORDER BY ts DESC LIMIT 1",
      ).get(to, amount, memo, excludeId, since);
      return r ? toRow(r) : null;
    },
    list(limit = 50): DecisionRow[] {
      return db.prepare("SELECT * FROM decisions ORDER BY request_id DESC LIMIT ?").all(limit).map(toRow);
    },
    paidEntries(): { amount: string; ts: number }[] {
      return db.prepare("SELECT amount, updated AS ts FROM decisions WHERE status = 'paid'").all()
        .map((r: any) => ({ amount: r.amount, ts: Number(r.ts) }));
    },
    close() { db.close(); },
  };
}
export type Store = ReturnType<typeof openStore>;
