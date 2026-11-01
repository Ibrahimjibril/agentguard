import type { Status } from "../lib/api";
import { statusView } from "../lib/format";
import type { Tone } from "../lib/format";

function Icon({ tone }: { tone: Tone }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {tone === "warn" ? (
        <>
          <path d="M8 2l6.5 11.5h-13z" />
          <path d="M8 6.5v3" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.6" />
          {tone === "allow" && <path d="M4.9 8.3l2.1 2.1 4.1-4.5" />}
          {tone === "block" && <path d="M4.6 11.4l6.8-6.8" />}
          {tone === "ask" && <path d="M8 4.6V8l2.4 1.6" />}
        </>
      )}
    </svg>
  );
}

// A verdict is never colour alone: it always has an icon and a word.
export function Stamp({ status }: { status: Status }) {
  const v = statusView(status);
  return (
    <span className={`stamp stamp-${v.tone}`}>
      <Icon tone={v.tone} />
      {v.label}
    </span>
  );
}
