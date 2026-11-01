"use client";
import { useState } from "react";
import type { Decision } from "../lib/api";
import { reasonTitle, shortAccount, timeAgo } from "../lib/format";
import { Stamp } from "./Stamp";

export function Log({ items }: { items: Decision[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) {
    return (
      <div className="card empty">
        <strong>No payments yet</strong>
        When your agent asks to pay, the decision and the reason will appear here.
      </div>
    );
  }
  return (
    <ul className="card lane">
      {items.map((d) => {
        const isOpen = open === d.id;
        const fresh = Date.now() - d.updated < 8000;
        return (
          <li className={`row${fresh ? " fresh" : ""}`} key={d.id}>
            <button className="row-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
              <Stamp status={d.status} />
              <span className="row-main">
                <span className="amt">{d.amountNear}</span>
                <span className="to">{shortAccount(d.to)}</span>
              </span>
              <span className="when">{timeAgo(d.updated)}</span>
            </button>
            {isOpen && (
              <div className="detail">
                {d.memo && <p className="memo">Agent’s note: “{d.memo}”</p>}
                <h4>Why</h4>
                <ul className="why">
                  {d.reasons.map((r, i) => (
                    <li key={`${r.code}-${i}`}><b>{reasonTitle(r.code)}.</b> {r.message}</li>
                  ))}
                </ul>
                <h4>Address check{d.risk.score === null ? "" : `: risk ${d.risk.score} of 100`}</h4>
                <ul className="why">
                  {d.risk.reasons.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
                {d.tx && (
                  <a className="link" href={`https://testnet.nearblocks.io/txns/${d.tx}`} target="_blank" rel="noreferrer">
                    View the transaction on NearBlocks
                  </a>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
