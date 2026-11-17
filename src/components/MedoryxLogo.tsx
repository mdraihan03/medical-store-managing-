interface MedoryxLogoProps {
  size?: number;
}

export function MedoryxLogo({ size = 32 }: MedoryxLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="medoryxBlue" x1="6" y1="8" x2="24" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284C7" />
          <stop offset="100%" stopColor="#0369A1" />
        </linearGradient>
        <linearGradient id="medoryxTeal" x1="24" y1="8" x2="42" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0D9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="1.5" />
      <path
        d="M11 36V13.5C11 12.12 12.64 11.4 13.66 12.33L24 21.8L20.5 26.2L16.5 22.5V36H11Z"
        fill="url(#medoryxBlue)"
      />
      <path
        d="M37 36V13.5C37 12.12 35.36 11.4 34.34 12.33L24 21.8L20.5 26.2L24 29.4L31.5 22.5V36H37Z"
        fill="url(#medoryxTeal)"
      />
    </svg>
  );
}
