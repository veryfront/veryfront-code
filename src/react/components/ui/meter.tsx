/**
 * Meter — a semantic gauge for a known, bounded measurement (disk usage, a
 * score, remaining quota). A leaf: one root `role="meter"` node carrying the
 * ARIA value range, containing a single fill `<div>` whose width reflects the
 * clamped percentage. Unlike a ProgressBar (task completion), a Meter reports a
 * static reading. Colour tokens follow the repo's `--status-*` semantic palette
 * (matching `Status`) so `success`/`warning`/`danger` read consistently.
 *
 * @example
 * ```tsx
 * import { Meter } from "veryfront/ui";
 *
 * <Meter value={82} variant="warning" label="Disk 82% full" />;
 * ```
 *
 * @module react/components/ui/meter
 */
import * as React from "react";
import { cva, cx as cn, type VariantProps } from "./cva.ts";

/** Fill colour by semantic variant — token-pure, keyed to the repo palette. */
const meterFill = cva("h-full rounded-full transition-all duration-500 ease-out", {
  variants: {
    variant: {
      default: "bg-[var(--primary)]",
      success: "bg-[var(--status-success)]",
      warning: "bg-[var(--status-warning)]",
      danger: "bg-[var(--destructive)]",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

/** Clamp `value` into `[min, max]` and return the fill percentage, guarding `max === min`. */
function toPercent(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clamped = Math.min(hi, Math.max(lo, Number.isFinite(value) ? value : lo));
  if (hi === lo) return 0;
  return ((clamped - lo) / (hi - lo)) * 100;
}

/** Clamp `value` into `[min, max]`, guarding non-finite input. */
function clampValue(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, Number.isFinite(value) ? value : lo));
}

/** Props accepted by `<Meter>`. */
export interface MeterProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children">, VariantProps<typeof meterFill> {
  /** Current reading. Clamped into `[min, max]`. @default (required) */
  value: number;
  /** Lower bound of the range. @default 0 */
  min?: number;
  /** Upper bound of the range. @default 100 */
  max?: number;
  /** Semantic colour of the fill. @default "default" */
  variant?: "default" | "success" | "warning" | "danger";
  /** Human-readable reading for assistive tech (`aria-valuetext`). @default undefined */
  label?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Render a semantic gauge with a fill sized to the clamped value. */
export function Meter({
  value,
  min = 0,
  max = 100,
  variant = "default",
  label,
  className,
  ref,
  ...props
}: MeterProps): React.ReactElement {
  const percent = toPercent(value, min, max);
  const now = clampValue(value, min, max);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return (
    <div
      ref={ref}
      role="meter"
      aria-valuenow={now}
      aria-valuemin={lo}
      aria-valuemax={hi}
      aria-valuetext={label}
      data-variant={variant}
      className={cn(
        "w-full h-2.5 overflow-hidden rounded-full bg-[var(--muted)]",
        className,
      )}
      {...props}
    >
      <div className={meterFill({ variant })} style={{ width: `${percent}%` }} />
    </div>
  );
}
