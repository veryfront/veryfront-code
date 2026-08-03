/**
 * Shimmer — ported 1:1 from Veryfront Studio. Animates a light band across text
 * via `bg-clip-text`, for streaming / loading states. Tokens remapped to
 * veryfront's `[var(--token)]` vocabulary (`--background`, `--soft` both exist);
 * Studio's app-only `can-hover:`/`touch:` variants are dropped in favour of the
 * standard `motion-safe`/`motion-reduce` pair. The `shimmer-sweep` keyframes
 * ship via chat `theme.ts`. Private to the chat module.
 *
 * @module react/components/ui/shimmer
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<Shimmer>`. */
export interface ShimmerProps {
  children: React.ReactNode;
  /** Element to render as. @default "span" */
  as?: React.ElementType;
  className?: string;
  /** Sweep duration in seconds. @default 2 */
  duration?: number;
  /** Band spread multiplier (× content length). @default 2 */
  spread?: number;
}

/** Render shimmering text. */
export function Shimmer({
  children,
  as: Component = "span",
  className,
  duration = 2,
  spread = 2,
}: ShimmerProps): React.ReactElement {
  const dynamicSpread = React.useMemo(() => {
    const length = typeof children === "string" ? children.length : 20;
    return length * spread;
  }, [children, spread]);

  return (
    <Component
      className={cn(
        "relative inline-block min-w-0 bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-position:100%_center]",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        "motion-safe:animate-[shimmer-sweep_linear_infinite] motion-reduce:bg-none motion-reduce:text-current",
        className,
      )}
      style={{
        "--spread": `${dynamicSpread}px`,
        animationDuration: `${duration}s`,
        backgroundImage: "var(--bg), linear-gradient(var(--soft), var(--soft))",
      } as React.CSSProperties}
    >
      {children}
    </Component>
  );
}
