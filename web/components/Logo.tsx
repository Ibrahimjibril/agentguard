// The AgentGuard mark: a G whose opening is a gate, with one payment passing through.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M37.02 13.07A17 17 0 1 0 41 24H25" stroke="var(--ink)" strokeWidth="6" />
      <circle cx="25" cy="24" r="4" fill="var(--accent)" />
    </svg>
  );
}
