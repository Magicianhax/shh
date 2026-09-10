/** Line icons drawn to the artboards' 1.8 stroke, so no emoji stands in. */

type P = { size?: number };

const s = (size: number, stroke = 1.8) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: stroke,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

/** The product mark: a rounded square with a plus, from the artboards. */
export const Mark = ({ size = 26 }: P) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="22" height="22" rx="6" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 13h10M13 8v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const LockIcon = ({ size = 18 }: P) => (
  <svg {...s(size)}>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

export const CheckIcon = ({ size = 16 }: P) => (
  <svg {...s(size, 2)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const ArrowIcon = ({ size = 18 }: P) => (
  <svg {...s(size, 2)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const SendIcon = ({ size = 18 }: P) => (
  <svg {...s(size, 2.2)}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const PlusIcon = ({ size = 16 }: P) => (
  <svg {...s(size, 2)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const CloseIcon = ({ size = 14 }: P) => (
  <svg {...s(size, 2)}>
    <path d="m5 5 14 14M19 5 5 19" />
  </svg>
);

export const MenuIcon = ({ size = 20 }: P) => (
  <svg {...s(size, 2)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const UserIcon = ({ size = 26 }: P) => (
  <svg {...s(size)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

export const ServerIcon = ({ size = 26 }: P) => (
  <svg {...s(size)}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M7 10h4M7 14h10" />
  </svg>
);

export const GlobeIcon = ({ size = 18 }: P) => (
  <svg {...s(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);

export const CopyIcon = ({ size = 14 }: P) => (
  <svg {...s(size, 1.6)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5A1.9 1.9 0 0 0 13.2 4H6a2 2 0 0 0-2 2v7.2A1.9 1.9 0 0 0 5.5 15" />
  </svg>
);

export const SunIcon = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.4 5.4 7.1 7.1M16.9 16.9l1.7 1.7M18.6 5.4 16.9 7.1M7.1 16.9l-1.7 1.7" />
  </svg>
);

export const MoonIcon = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z" />
  </svg>
);

export const RefreshIcon = ({ size = 16 }: P) => (
  <svg {...s(size, 1.8)}>
    <path d="M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2" />
    <path d="M18 3v4h-4M6 21v-4h4" />
  </svg>
);
