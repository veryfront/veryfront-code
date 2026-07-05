import * as React from "react";

// Inline SVG icons replacing Studio's `@/icons` (banned here). Each accepts a
// `className` so the kit's Tailwind sizing utilities (e.g. `size-4`) apply.

type IconProps = { className?: string };

function Svg(
  { className, children }: IconProps & { children: React.ReactNode },
): React.ReactElement {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function Check(props: IconProps): React.ReactElement {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

export function Copy(props: IconProps): React.ReactElement {
  return (
    <Svg {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Svg>
  );
}

export function ArrowRight(props: IconProps): React.ReactElement {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  );
}

export function ArrowDown(props: IconProps): React.ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </Svg>
  );
}
