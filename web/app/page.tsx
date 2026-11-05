"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, decide, getSetup, getState, isDemo } from "../lib/api";
import type { SetupStatus, State } from "../lib/api";
import { nearFmt, yoctoToNear } from "../lib/format";
import { Logo } from "../components/Logo";
import { GateArt } from "../components/GateArt";
import { Meter } from "../components/Meter";
import { NeedsYou } from "../components/NeedsYou";
import { Log } from "../components/Log";
import { Rules } from "../components/Rules";
import { Onboarding } from "../components/Onboarding";
import { ConnectAgent } from "../components/ConnectAgent";
import { Playground } from "../components/Playground";

const REPO = "https://github.com/Ibrahimjibril/agentguard";

type Ov = Record<number, "paid" | "human_rejected">;

// Hosted demo only: approve/decline are simulated in this browser session.
function applyDemo(st: State, ov: Ov): State {
  if (!isDemo || Object.keys(ov).length === 0) return st;
  let spent = 0;
  const decisions = st.decisions.map((d) => {
    const o = ov[d.id];
    if (!o || d.status !== "awaiting_approval") return d;
    if (o === "paid") spent += Number(d.amountNear);
    return { ...d, status: o, updated: Date.now() };
  });
  const awaiting = decisions.filter((d) => d.status === "awaiting_approval").length;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const vault = st.vault
    ? { ...st.vault, spentTodayNear: r6(st.vault.spentTodayNear + spent), balanceNear: r6(st.vault.balanceNear - spent) }
    : st.vault;
  return { ...st, decisions, awaiting, vault };
}

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoOv = useRef<Ov>({});

  const refresh = useCallback(async () => {
    try {
      const s = await getSetup();
      setSetup(s);
      if (s.stage === "deployed") setState(applyDemo(await getState(), demoOv.current));
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
    if (isDemo) {
      demoOv.current[id] = approve ? "paid" : "human_rejected";
      notify(approve ? "Simulated: approved. In the self-hosted version the vault pays on-chain." : "Simulated: declined. Nothing was sent.");
      refresh();
      return;
    }
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
  const needsSetup = setup !== null && setup.stage !== "deployed";
  const statusText = offline
    ? "Guard offline"
    : needsSetup
      ? "Not set up yet"
      : state
        ? (isDemo ? "Live demo" : "Guard online")
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
            <a className="btn btn-accent" href={isDemo ? "#playground" : needsSetup ? "#setup" : "#rules"}>
              {isDemo ? "Try it live" : needsSetup ? "Create your sandbox" : "Write your rules"}
            </a>
            {!needsSetup && <a className="link-quiet" href="#log">See the decisions</a>}
{isDemo && <a className="link-quiet" href={REPO} target="_blank" rel="noreferrer">Run it locally</a>}
          </div>
        </div>
        <GateArt />
      </section>

      {isDemo && state?.snapshot && (
        <div className="banner banner-info" role="note">
          <b>Recorded log, live checker.</b> The decisions below are real ones from a NEAR testnet run on{" "}
          {new Date(state.snapshot.capturedAt).toLocaleDateString()}. Want to try your own payment? Scroll to <a className="link" href="#playground">Try the gate</a>. To approve payments and write rules,{" "}
          <a className="link" href={`${state.snapshot.repo}#try-it`} target="_blank" rel="noreferrer">run AgentGuard yourself</a>.
        </div>
      )}

      {offline && !isDemo && (
        <div className="banner" role="alert">
          <b>Can’t reach the Guard</b> at {API_BASE}. Start it from the project folder with <code>npm run serve</code>.
        </div>
      )}

      {needsSetup && setup ? (
        <Onboarding setup={setup} onChanged={refresh} notify={notify} />
      ) : (
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
      )}

      {!isDemo && setup && setup.stage === "deployed" && <ConnectAgent setup={setup} notify={notify} />}

{isDemo && <Playground />}
      <footer className="foot">
        The AI only drafts your rules. Plain code makes every decision, and the vault enforces its own limits on-chain.
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
