export function TaxiIcon({ size = 26, color = '#000' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 17h14v-5l-2-5H7l-2 5v5z" />
      <path d="M5 12h14" />
      <circle cx="8" cy="17" r="1.6" />
      <circle cx="16" cy="17" r="1.6" />
      <path d="M10 7V5h4v2" />
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="font-display font-extrabold leading-none tracking-wider" style={{ fontSize: size }}>
      RÝCHLE <span className="text-taxi">TAXI</span>
    </span>
  );
}
