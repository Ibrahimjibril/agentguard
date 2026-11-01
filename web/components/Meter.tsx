import { nearFmt } from "../lib/format";

interface Props { spent: number; rule: number | null; chain: number }

// One track, two limits: your rule and the chain's hard cap. Defence in depth, visible.
export function Meter({ spent, rule, chain }: Props) {
  const max = Math.max(chain, rule ?? 0, spent, 0.0001);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const label = `Spent today ${nearFmt(spent)} NEAR. ${rule !== null ? `Your daily rule ${nearFmt(rule)} NEAR. ` : ""}On-chain cap ${nearFmt(chain)} NEAR.`;
  return (
    <div className="meter" role="img" aria-label={label}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: pct(spent) }} />
        {rule !== null && <div className="tick tick-rule" style={{ left: pct(rule) }} />}
        <div className="tick tick-chain" style={{ left: pct(chain) }} />
      </div>
      <ul className="legend">
        <li><i className="sw sw-spent" />Spent today <b>{nearFmt(spent)}</b></li>
        {rule !== null && <li><i className="sw sw-rule" />Your rule <b>{nearFmt(rule)}</b></li>}
        <li><i className="sw sw-chain" />Chain cap <b>{nearFmt(chain)}</b></li>
      </ul>
    </div>
  );
}
