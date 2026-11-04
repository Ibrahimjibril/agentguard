"use client";
import { useState } from "react";
import { createOwner, deploySandbox } from "../lib/api";
import type { SetupStatus } from "../lib/api";

interface Props {
  setup: SetupStatus;
  onChanged: () => void;
  notify: (msg: string) => void;
}

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

export function Onboarding({ setup, onChanged, notify }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"owner" | "deploy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameOk = name.length >= 3 && NAME_RE.test(name);
  const ownerDone = setup.stage !== "no_owner";

  async function makeOwner() {
    setBusy("owner");
    setError(null);
    try {
      const r = await createOwner(name);
      if (r.ok) {
        notify(`Created ${r.owner}`);
        onChanged();
      } else {
        setError(r.error ?? "Could not create the account.");
      }
    } catch {
      setError("Could not reach the Guard.");
    }
    setBusy(null);
  }

  async function makeSandbox() {
    setBusy("deploy");
    setError(null);
    try {
      const r = await deploySandbox();
      if (r.ok) {
        notify("Your sandbox is ready.");
        onChanged();
      } else {
        setError(r.error ?? "Could not create the sandbox.");
      }
    } catch {
      setError("Could not reach the Guard.");
    }
    setBusy(null);
  }

  return (
    <section className="card onboard" id="setup" aria-labelledby="onb-title">
      <h2 id="onb-title">Create your sandbox</h2>
      <p className="hint">
        Two steps, about two minutes. Everything is created on NEAR testnet, and the keys stay on this computer.
      </p>
      <ol className="steps">
        <li className={`step ${ownerDone ? "done" : "active"}`}>
          <span className="step-num">{ownerDone ? "✓" : "1"}</span>
          <div className="step-body">
            <h3>Your owner account</h3>
            {ownerDone ? (
              <p>Created: <b>{setup.owner}</b></p>
            ) : (
              <>
                <label htmlFor="owner-name" className="label">Pick a name</label>
                <div className="field">
                  <input
                    id="owner-name"
                    value={name}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="alice-agents"
                    onChange={(e: { target: { value: string } }) => setName(e.target.value.toLowerCase())}
                  />
                  <span>.testnet</span>
                </div>
                <p className="hint">3 to 30 lowercase letters, digits or hyphens. The testnet faucet pays for it.</p>
                <div className="actions">
                  <button className="btn btn-accent" disabled={!nameOk || busy !== null} onClick={makeOwner}>
                    {busy === "owner" ? "Creating (about 20 seconds)…" : "Create account"}
                  </button>
                </div>
              </>
            )}
          </div>
        </li>
        <li className={`step ${ownerDone ? "active" : "locked"}`}>
          <span className="step-num">2</span>
          <div className="step-body">
            <h3>The sandbox</h3>
            <p>
              This creates three accounts under {setup.owner ?? "your account"}: a <b>vault</b> that holds the money and has
              no keys at all, a <b>guardian</b> that approves payments, and an <b>agent</b> whose only key can ask the vault
              for a payment. The vault starts with 6 NEAR of testnet money.
            </p>
            <div className="actions">
              <button className="btn btn-accent" disabled={!ownerDone || busy !== null} onClick={makeSandbox}>
                {busy === "deploy" ? "Creating (about a minute)…" : "Create the sandbox"}
              </button>
            </div>
            {busy === "deploy" && <p className="hint">Please keep this page open until it finishes.</p>}
          </div>
        </li>
      </ol>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
