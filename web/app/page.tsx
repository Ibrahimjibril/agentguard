"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, decide, getState, isDemo } from "../lib/api";
import type { State } from "../lib/api";
import { nearFmt, yoctoToNear } from "../lib/format";
import { Logo } from "../components/Logo";
import { GateArt } from "../components/GateArt";
import { Meter } from "../components/Meter";
import { NeedsYou } from "../components/NeedsYou";
import { Log } from "../components/Log";
import { Rules } from "../components/Rules";

const REPO = "https://github.com/Ibrahimjibril/agentguard";

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [offline, setOffline] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  async function onDecide(id: number, approve: boolean) {
    setBusyId(id);
    const r = await decide(id, approve).catch(() => ({ ok: false, error: "Could not reach the Guard." }));
    setBusyId(null);
    notify(r.ok ? (approve ? "Approved. The vault is paying." : "Declined.") : (r.error ?? "Something went wrong."));
    refresh();
  }

  const vault = state?.vault ?? null;
  const ruleDaily = yoctoToNear(state?.policy?.json?.daily_limit);
  const rulePerTx = yoctoToNear(state?.policy?.json?.per_tx_limit);
  const decisions = state?.decisions ?? [];
  const waiting = decisions.filter((d) => d.status === "awaiting_approval");
  const statusText = offline
    ? "Guard offline"
    : state
      ? (isDemo ? "Recorded run · NEAR testnet" : "Guard online · NEAR testnet")
      : "Connecting…";

  return (
    <div className="shell">
      <header className="top">
        <div className="brand"><Logo size={30} /><span>AgentGuard</span></div>
        <div className="status" aria-live="polite">
          <span className={`dot ${offline ? "off" : state ? "on" : ""}`} />
          {statusText}
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" />AI agent security on NEAR</p>
          <h1>Your agent can ask.<br /><em>The gate decides.</em></h1>
          <p className="lead">
            Give an AI agent money without giving it your keys. Every payment passes your rules, a scam check and the vault’s own on-chain limits before anything moves.
          </p>
          <div className="hero-cta">
            <a className="btn btn-accent" href={isDemo ? (state?.snapshot?.repo ?? REPO) : "#rules"} target={isDemo ? "_blank" : undefined} rel={isDemo ? "noreferrer" : undefined}>
              {isDemo ? "Run it yourself" : "Write your rules"}
            </a>
            <a className="link-quiet" href="#log">See the decisions</a>
          </div>
        </div>
        <GateArt />
      </section>

      {isDemo && state?.snapshot && (
        <div className="banner banner-info" role="note">
          <b>Recorded demo.</b> These are real decisions from a live NEAR testnet run on{" "}
          {new Date(state.snapshot.capturedAt).toLocaleDateString()}. To approve payments and write rules,{" "}
          <a className="link" href={state.snapshot.repo} target="_blank" rel="noreferrer">run AgentGuard yourself</a>.
        </div>
      )}

      {offline && !isDemo && (
        <div className="banner" role="alert">
          <b>Can’t reach the Guard</b> at {API_BASE}. Start it from the project folder with <code>npm run serve</code>.
        </div>
      )}

      <div className="layout">
        <main className="col-main">
          <section className="card vault">
            <div className="vault-head">
              <h2>The vault</h2>
              {vault && <span className="pill">{vault.vault}</span>}
            </div>
            {vault ? (
              <>
                <div className="stats">
                  <div className="stat">
                    <span>In the vault</span>
                    <b>{nearFmt(vault.balanceNear)} NEAR</b>
                  </div>
                  <div className="stat">
                    <span>Per payment</span>
                    <b>{rulePerTx !== null ? `${nearFmt(rulePerTx)} NEAR` : "no rule"}</b>
                    <small>chain cap {nearFmt(vault.hardPerTxNear)}</small>
                  </div>
                  <div className="stat">
                    <span>Needs you</span>
                    <b>{state?.awaiting ?? 0}</b>
                  </div>
                </div>
                <Meter spent={vault.spentTodayNear} rule={ruleDaily} chain={vault.hardDailyNear} />
              </>
            ) : (
              <p className="hint">{state ? "Loading the vault…" : "Connecting to the Guard…"}</p>
            )}
          </section>

          <NeedsYou items={waiting} busyId={busyId} onDecide={onDecide} />

          <div className="sec-title" id="log">
            <h2>Checkpoint log</h2>
            <span className="count">{decisions.length} decisions</span>
          </div>
          <Log items={decisions} />
        </main>

        <div className="col-rules">
          <Rules state={state} onChanged={refresh} notify={notify} />
        </div>
      </div>

      <footer className="foot">
        The AI only drafts your rules. Plain code makes every decision, and the vault enforces its own limits on-chain.
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
