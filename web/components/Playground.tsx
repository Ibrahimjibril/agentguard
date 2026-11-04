"use client";
import { useState } from "react";

type Verdict = "allow" | "block" | "ask";
interface Result {
  verdict: Verdict;
  reasons: { code: string; verdict: Verdict; message: string }[];
  risk: { score: number | null; reasons: string[] };
  to: string;
  amountNear: string;
}
interface KeyRow { key: string; kind: string; receiver?: string; methods?: string[] }
interface Acct { account: string; keys: KeyRow[] | null }

const COLOR: Record<Verdict, string> = { allow: "#1f7a4d", block: "#c8381a", ask: "#b7791f" };
const TITLE: Record<Verdict, string> = {
  allow: "Allowed: the vault would pay",
  block: "Blocked: no money moves",
  ask: "Waiting for a human to approve",
};
const OWNER = "jibsonfta.testnet";
const PRESETS = [
  { label: "Normal payment", to: OWNER, amount: "0.5" },
  { label: "Over the limit", to: OWNER, amount: "2.5" },
  { label: "Lookalike address", to: "jibsonfat.testnet", amount: "1" },
  { label: "Needs approval", to: OWNER, amount: "1.7" },
  { label: "Phishing name", to: "free-airdrop-claim.testnet", amount: "1" },
];
const field = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,.25)",
  background: "transparent", font: "inherit", color: "inherit", boxSizing: "border-box",
} as const;
const lab = { display: "block", fontSize: 13, opacity: 0.75, marginBottom: 4 } as const;

export function Playground() {
  const [to, setTo] = useState(OWNER);
  const [amount, setAmount] = useState("0.5");
  const [perTx, setPerTx] = useState("2");
  const [daily, setDaily] = useState("5");
  const [approval, setApproval] = useState("1.5");
  const [spent, setSpent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [keys, setKeys] = useState<Acct[] | null>(null);
  const [keysBusy, setKeysBusy] = useState(false);

  async function run(t = to, a = amount) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: t, amountNear: a, perTxNear: perTx, dailyNear: daily, approvalNear: approval, spentTodayNear: String(spent) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setErr(j.error ?? "Something went wrong."); setRes(null); }
      else {
        setRes(j as Result);
        if (j.verdict === "allow") setSpent((s) => Math.round((s + Number(a)) * 1e6) / 1e6);
      }
    } catch { setErr("Could not reach the checker."); }
    setBusy(false);
  }

  async function verify() {
    setKeysBusy(true);
    try { setKeys((await (await fetch("/api/verify-keys")).json()).accounts); }
    catch { setKeys([]); }
    setKeysBusy(false);
  }

  return (
    <section id="playground" className="card" style={{ marginTop: 24 }}>
      <div className="vault-head">
        <h2>Try the gate</h2>
        <span className="pill">Live checker</span>
      </div>
      <p className="hint">
        You are the agent. Ask for a payment and watch the Guard decide. It runs the same policy checker and scam check as the real Guard, against live NEAR testnet data. No money moves.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
        {PRESETS.map((p) => (
          <button key={p.label} className="pill" style={{ cursor: "pointer" }} disabled={busy}
            onClick={() => { setTo(p.to); setAmount(p.amount); run(p.to, p.amount); }}>
            {p.label}
          </button>
        ))}
      </div>

      <label style={lab}>Send to (NEAR account)</label>
      <input style={field} value={to} onChange={(e) => setTo(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <label style={{ ...lab, marginTop: 10 }}>Amount (NEAR)</label>
      <input style={field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />

      <p className="hint" style={{ marginTop: 14 }}>Your rules (NEAR, empty means no limit)</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div><label style={lab}>Per payment</label><input style={field} value={perTx} onChange={(e) => setPerTx(e.target.value)} inputMode="decimal" /></div>
        <div><label style={lab}>Per day</label><input style={field} value={daily} onChange={(e) => setDaily(e.target.value)} inputMode="decimal" /></div>
        <div><label style={lab}>Ask above</label><input style={field} value={approval} onChange={(e) => setApproval(e.target.value)} inputMode="decimal" /></div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <button className="btn btn-accent" onClick={() => run()} disabled={busy}>{busy ? "Checking…" : "Ask the Guard"}</button>
        <span className="hint">Spent today in this test: {spent} NEAR{" "}
          {spent > 0 && <a className="link" href="#playground" onClick={() => setSpent(0)}>reset</a>}
        </span>
      </div>

      {err && <p role="alert" style={{ color: "#c8381a", marginTop: 12 }}>{err}</p>}

      {res && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: `2px solid ${COLOR[res.verdict]}` }}>
          <b style={{ color: COLOR[res.verdict], fontSize: 18 }}>{TITLE[res.verdict]}</b>
          <p className="hint" style={{ margin: "4px 0 8px" }}>{res.amountNear} to {res.to}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {res.reasons.map((r, i) => <li key={i}>{r.message}</li>)}
          </ul>
          <p className="hint" style={{ marginTop: 10 }}>
            Scam check: {res.risk.score === null ? "unavailable (fails safe to a human)" : `risk ${res.risk.score}/100`}
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {res.risk.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      <hr style={{ margin: "20px 0", opacity: 0.2 }} />
      <h3 style={{ margin: "0 0 6px" }}>Don’t trust us, check the chain</h3>
      <p className="hint">Reads the real access keys of the vault and the agent from NEAR testnet right now.</p>
      <button className="btn" onClick={verify} disabled={keysBusy} style={{ marginTop: 8 }}>
        {keysBusy ? "Reading the chain…" : "Verify on-chain"}
      </button>
      {keys && keys.map((a) => (
        <div key={a.account} style={{ marginTop: 12 }}>
          <b>{a.account}</b>
          {a.keys === null ? <p className="hint">Could not read this account right now.</p>
            : a.keys.length === 0 ? <p style={{ color: "#1f7a4d", margin: "4px 0" }}>No access keys. Nobody can sign as this account.</p>
            : a.keys.map((k, i) => (
              <p key={i} className="hint" style={{ margin: "4px 0", wordBreak: "break-all" }}>
                {k.kind === "FullAccess" ? "FULL ACCESS key" : `Function-call key: only ${(k.methods ?? []).join(", ") || "any method"} on ${k.receiver}`}
              </p>
            ))}
        </div>
      ))}
    </section>
  );
}
