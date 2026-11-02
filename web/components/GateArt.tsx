// Hero illustration: payments queue at an open gate, and one passes through.
export function GateArt() {
  return (
    <svg className="hero-art" viewBox="0 0 340 280" role="img" aria-label="Coins queue at an open gate while one coin passes through.">
      <circle cx="150" cy="140" r="118" fill="var(--blue-bg)" />
      <circle cx="150" cy="140" r="130" fill="none" stroke="var(--blue)" strokeWidth="2" strokeDasharray="1 9" strokeLinecap="round" />
      <g transform="translate(26 16) scale(5.2)" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M37.02 13.07A17 17 0 1 0 41 24H25" stroke="var(--ink)" strokeWidth="6" />
        <circle cx="25" cy="24" r="4" fill="var(--accent)" />
      </g>
      <g fill="var(--paper)" stroke="var(--ink)" strokeWidth="3">
        <circle cx="306" cy="44" r="10" />
        <circle cx="276" cy="68" r="8" />
        <circle cx="252" cy="90" r="6.5" />
      </g>
    </svg>
  );
}
