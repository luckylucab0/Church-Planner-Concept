// ServeFlow-Logo: "Flow Cross"-Icon (vier versetzte, abgerundete Balken)
// + Wortmarke (Sora Bold, "Serve" paper / "Flow" gold). Das Icon-SVG
// liegt inline, damit die Goldfarbe garantiert stimmt und keine
// zusätzliche Netzwerkanfrage nötig ist.
export function LogoIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      fill="var(--color-gold)"
    >
      <rect x="30" y="4" width="9" height="25" rx="4.5" />
      <rect x="25" y="35" width="9" height="25" rx="4.5" />
      <rect x="4" y="30" width="25" height="9" rx="4.5" />
      <rect x="35" y="25" width="25" height="9" rx="4.5" />
    </svg>
  );
}

// Logo-Lockup: Icon + Wortmarke nebeneinander. `wordmarkSize` steuert die
// Schriftgröße der Wortmarke; das Icon ist etwas größer, der Abstand
// ≈ 0.4× Icon-Höhe (Handoff).
export function Logo({
  iconSize = 24,
  wordmarkSize = 17,
}: {
  iconSize?: number;
  wordmarkSize?: number;
}) {
  return (
    <span
      className="inline-flex items-center"
      style={{ gap: iconSize * 0.4 }}
      aria-label="ServeFlow"
    >
      <LogoIcon size={iconSize} />
      <span
        className="font-display font-bold"
        style={{ fontSize: wordmarkSize, letterSpacing: '-0.02em', lineHeight: 1 }}
      >
        <span className="text-paper">Serve</span>
        <span className="text-gold">Flow</span>
      </span>
    </span>
  );
}
