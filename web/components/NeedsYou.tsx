import type { Decision } from "../lib/api";
import { reasonTitle, shortAccount, timeAgo } from "../lib/format";

interface Props {
  items: Decision[];
  busyId: number | null;
  onDecide: (id: number, approve: boolean) => void;
}

export function NeedsYou({ items, busyId, onDecide }: Props) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="needs-title">
      <div className="sec-title">
        <h2 id="needs-title">Needs you</h2>
        <span className="count">{items.length} waiting</span>
      </div>
      {items.map((d) => (
        <article className="card need" key={d.id}>
          <div className="need-top">
            <div className="amount">{d.amountNear}</div>
            <div className="when">{timeAgo(d.ts)}</div>
          </div>
          <p className="to">to <b>{shortAccount(d.to)}</b></p>
          {d.memo && <p className="memo">“{d.memo}”</p>}
          <ul className="why">
            {d.reasons.map((r) => (
              <li key={r.code}><b>{reasonTitle(r.code)}.</b> {r.message}</li>
            ))}
          </ul>
          <div className="actions">
            <button className="btn btn-primary" disabled={busyId === d.id} onClick={() => onDecide(d.id, true)}>
              {busyId === d.id ? "Working…" : "Approve and pay"}
            </button>
            <button className="btn btn-danger" disabled={busyId === d.id} onClick={() => onDecide(d.id, false)}>
              Decline
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
