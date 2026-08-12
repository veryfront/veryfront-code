/**
 * NumberField — a numeric text input with clamping and keyboard stepping.
 *
 * A single `<input inputmode="numeric">` that keeps its value within
 * `[min, max]`, rounds to `step`, and steps with ArrowUp/ArrowDown. Controlled
 * via `value`/`onValueChange` or uncontrolled via `defaultValue`. Skinned with
 * the veryfront theme tokens; no adapter or engine required.
 *
 * @example Uncontrolled, clamped 0–10
 * ```tsx
 * import { NumberField } from "veryfront/ui";
 *
 * <NumberField defaultValue={1} min={0} max={10} aria-label="Quantity" />;
 * ```
 *
 * @example Controlled
 * ```tsx
 * const [qty, setQty] = React.useState(1);
 * <NumberField value={qty} onValueChange={setQty} min={1} step={1} />;
 * ```
 *
 * @module react/components/ui/number-field
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<NumberField>`. */
export interface NumberFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> {
  /** Controlled value (pair with `onValueChange`). `null` means empty. */
  value?: number | null;
  /** Initial value when uncontrolled. */
  defaultValue?: number;
  /** Fires with the next value (`null` when the field is cleared). */
  onValueChange?: (value: number | null) => void;
  /** Smallest allowed value; also the floor for ArrowDown stepping. */
  min?: number;
  /** Largest allowed value; also the ceiling for ArrowUp stepping. */
  max?: number;
  /** Increment applied on ArrowUp/ArrowDown and used to round input. @default 1 */
  step?: number;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLInputElement>;
}

function clamp(n: number, min?: number, max?: number): number {
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

/** Render a numeric input that clamps to `[min, max]` and steps by `step`. */
export function NumberField({
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  step = 1,
  className,
  disabled,
  onKeyDown,
  ref,
  ...props
}: NumberFieldProps): React.ReactElement {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<number | null>(defaultValue ?? null);
  const current = isControlled ? value : internal;

  const commit = (next: number | null) => {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.trim();
    if (raw === "") return commit(null);
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    commit(clamp(parsed, min, max));
  };

  const nudge = (direction: 1 | -1) => {
    const base = current ?? (direction === 1 ? (min ?? 0) - step : (max ?? 0) + step);
    commit(clamp(base + direction * step, min, max));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      nudge(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      nudge(-1);
    }
  };

  return (
    <input
      ref={ref}
      inputMode="numeric"
      role="spinbutton"
      aria-valuenow={current ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      disabled={disabled}
      value={current ?? ""}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "h-[38px] w-full rounded-md px-3 text-base tabular-nums",
        "bg-[var(--input-bg)] text-[var(--foreground)]",
        "border border-[var(--outline-border)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--edge-medium)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
