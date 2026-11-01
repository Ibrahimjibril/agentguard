"use client";
import { useState } from "react";
import { activateRules, draftRules, isDemo } from "../lib/api";
import type { Draft, State } from "../lib/api";

interface Props {
  state: State | null;
  onChanged: () => void;
  notify: (msg: string) => void;
}

export function Rules({ state, onChanged, notify }: Props) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function makeDraft() {
    setBusy(true); setError(null); setDraft(null); setConfirmed(false);
    try {
      const r = await draftRules(text);
      if (r.ok) setDraft(r.draft); else setError(r.error);
    } catch {
      setError("Could not reach the Guard.");
    }
    setBusy(false);
  }

  async function activate() {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      const r = await activateRules(draft.policy, confirmed);
      if (r.ok) {
        notify("Rules are live. Every new payment is checked against them.");
        setDraft(null); setText(""); setConfirmOpen(false); onChanged();
      } else if (r.needsConfirmation) {
        setConfirmOpen(true);
      } else {
        setError(r.error);
      }
    } catch {
      setError("Could not reach the Guard.");
    }
    setBusy(false);
  }

  const active = state?.policy ?? null;
  return (
    <aside className="card rules" aria-labelledby="rules-title">
      <h2 id="rules-title">Your rules</h2>
      {active ? (
        <ul className="rule-list">
          {active.summary.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : (
        <div className="callout warn">
          <b>No rules yet.</b> Until you set some, every payment waits for you.
        </div>
      )}

      <label htmlFor="rules-text" className="label">Write new rules in any language</label>
      <textarea
        id="rules-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="No more than 2 NEAR per payment and 5 NEAR a day. Ask me above 1.5 NEAR."
      />
      <div className="actions">
        <button className="btn btn-primary" disabled={busy || isDemo || text.trim().length === 0 || state?.llmConfigured === false} onClick={makeDraft}>
          {busy && !draft ? "Drafting…" : "Draft rules"}
        </button>
      </div>
      {isDemo && <p className="hint">Recorded demo: rules can only be written when you run AgentGuard yourself.</p>}
      {!isDemo && state?.llmConfigured === false && (
        <p className="hint">Drafting needs an LLM key in <code>.env</code>. See <code>.env.example</code>.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {draft && (
        <div className="draft">
          <h3>Draft: check it before it goes live</h3>
          <ul className="rule-list">
            {draft.summary.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {draft.warnings.map((w) => <div className="callout warn" key={w}>{w}</div>)}
          {(confirmOpen || draft.warnings.length > 0) && (
            <label className="check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I understand this leaves a limit open.
            </label>
          )}
          <details>
            <summary>See the exact rule file</summary>
            <pre>{JSON.stringify(draft.policy, null, 2)}</pre>
          </details>
          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={busy || (draft.warnings.length > 0 && !confirmed)}
              onClick={activate}
            >
              Make these rules live
            </button>
            <button className="btn btn-ghost" onClick={() => { setDraft(null); setConfirmOpen(false); }}>Discard</button>
          </div>
        </div>
      )}
    </aside>
  );
}
