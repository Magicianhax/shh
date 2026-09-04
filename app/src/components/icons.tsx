/** Authored 16px line icons, one stroke weight, so no glyph stands in for an icon. */

type Props = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const CopyIcon = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
    <path d="M10.5 3.2A1.7 1.7 0 0 0 8.9 2H4.2A2.2 2.2 0 0 0 2 4.2v4.7c0 .74.47 1.37 1.2 1.6" />
  </svg>
);

export const CheckIcon = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 8.4 6.2 11.6 13 4.8" />
  </svg>
);

export const LinkIcon = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <path d="M9 3h4v4" />
    <path d="m13 3-5.6 5.6" />
    <path d="M12.2 9.8V12A1.8 1.8 0 0 1 10.4 13.8H4A1.8 1.8 0 0 1 2.2 12V5.6A1.8 1.8 0 0 1 4 3.8h2.2" />
  </svg>
);

export const RefreshIcon = ({ size = 13 }: Props) => (
  <svg {...base(size)}>
    <path d="M13.2 7A5.3 5.3 0 0 0 3.6 4.6" />
    <path d="M2.8 9A5.3 5.3 0 0 0 12.4 11.4" />
    <path d="M3.2 1.9v2.9h2.9M12.8 14.1v-2.9H9.9" />
  </svg>
);

export const Wordmark = ({ size = 22 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path
      d="M10 21V11m6 10V11m6 10V15"
      fill="none"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  </svg>
);
