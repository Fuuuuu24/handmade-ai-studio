// 统一的 1.5px 线条图标（沿用 v2／v3 原型自绘的 SVG，不引入第三方图标库）
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  home: <path d="M4.5 10.5 12 4.5l7.5 6V19a1 1 0 0 1-1 1h-4v-5.5h-5V20h-4a1 1 0 0 1-1-1z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.7 9.4a2.4 2.4 0 0 1 4.6.9c0 1.6-2.3 2-2.3 3.4" />
      <circle cx="12" cy="16.7" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M7 7l10 10M17 7 7 17" />,
  send: <path d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5" />,
  check: <path d="M5.5 12.5 10 17l8.5-9.5" />,
  upload: (
    <>
      <path d="M12 15.5V5M7.5 9.5 12 5l4.5 4.5" />
      <path d="M5 14.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 15.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 15.5 16 11l-8.5 8" />
    </>
  ),
  works: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  style: (
    <>
      <path d="M12 3.5c-4.9 0-8.5 3.6-8.5 8.3 0 4.6 3.6 8.2 8.2 8.2 1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h2c2.7 0 4.5-1.9 4.5-4.5 0-3.4-3.8-6-8.8-6z" />
      <circle cx="7.8" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="7.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="8.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12A8.5 8.5 0 1 0 6 6L3.5 8.5" />
      <path d="M3.5 4v4.5H8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  trash: <path d="M5 7h14M10 4.5h4M7 7l.7 11a2 2 0 0 0 2 1.9h4.6a2 2 0 0 0 2-1.9L17 7" />,
  back: <path d="M14.5 6.5 9 12l5.5 5.5" />,
  retry: (
    <>
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M19 4.5V9h-4.5" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  chevronDown: <path d="M7 10l5 5 5-5" />,
  chevronLeft: <path d="M14.5 6.5 9 12l5.5 5.5" />,
  chevronRight: <path d="M9.5 6.5 15 12l-5.5 5.5" />,
  arrowRight: <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
  arrowUpRight: <path d="M7.5 16.5l9-9M9 7.5h7.5V15" />,
  alert: (
    <>
      <path d="M12 4.5 20.5 19h-17z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  sparkle: <path d="M12 4.5c.6 3.6 1.9 4.9 5.5 5.5-3.6.6-4.9 1.9-5.5 5.5-.6-3.6-1.9-4.9-5.5-5.5 3.6-.6 4.9-1.9 5.5-5.5zM18 15.5c.3 1.5.8 2 2.3 2.3-1.5.3-2 .8-2.3 2.3-.3-1.5-.8-2-2.3-2.3 1.5-.3 2-.8 2.3-2.3z" />,
  spinner: <path d="M12 4.5a7.5 7.5 0 1 1-7.5 7.5" />,
} as const;

export type IconName = keyof typeof PATHS;

// size：React Bits 组件里按像素指定大小；不传时由 .icon 和外层样式决定
export function Icon({ name, className = '', size }: { name: IconName; className?: string; size?: number }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {PATHS[name]}
    </svg>
  );
}
