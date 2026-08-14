/**
 * NumberField - a numeric text input with clamping and keyboard stepping.
 *
 * A single `<input>` that keeps its value within
 * `[min, max]`, rounds to `step`, and steps with ArrowUp/ArrowDown. Controlled
 * via `value`/`onValueChange` or uncontrolled via `defaultValue`. Skinned with
 * the veryfront theme tokens; no adapter or engine required.
 *
 * @example Uncontrolled, clamped 0-10
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

const COMPLETE_NUMBER_PATTERN = /^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMERIC_PREFIX_PATTERN = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d*))?(?:[eE][+-]?\d*)?$/;

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

function decimalPlaces(value: number): number {
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  const fractionLength = coefficient?.split(".")[1]?.length ?? 0;
  const exponent = Number(exponentText ?? 0);
  return Math.max(0, fractionLength - exponent);
}

/** Quantize a value to the nearest positive step, using `min` as the step base. */
export function quantizeNumberFieldValue(value: number, step: number, min?: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const base = min ?? 0;
  const quantized = base + Math.round((value - base) / step) * step;
  const precision = Math.min(12, Math.max(decimalPlaces(base), decimalPlaces(step)));
  return Number(quantized.toFixed(precision));
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
  inputMode,
  onKeyDown,
  onBlur,
  ref,
  ...props
}: NumberFieldProps): React.ReactElement {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<number | null>(defaultValue ?? null);
  const [draft, setDraft] = React.useState<string | null>(null);
  const current = isControlled ? value : internal;
  const controlledValueRef = React.useRef(value);
  const resolvedInputMode = inputMode ?? (Number.isInteger(step) ? "numeric" : "decimal");

  React.useEffect(() => {
    if (isControlled && !Object.is(controlledValueRef.current, value)) setDraft(null);
    controlledValueRef.current = value;
  }, [isControlled, value]);

  const commit = (next: number | null) => {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.trim();
    if (raw === "") {
      setDraft(null);
      return commit(null);
    }
    if (NUMERIC_PREFIX_PATTERN.test(raw) && !COMPLETE_NUMBER_PATTERN.test(raw)) {
      setDraft(event.target.value);
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    setDraft(null);
    commit(clamp(quantizeNumberFieldValue(parsed, step, min), min, max));
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    onBlur?.(event);
    if (event.defaultPrevented || draft == null) return;
    const parsed = Number(draft.trim());
    setDraft(null);
    if (!Number.isNaN(parsed)) {
      commit(clamp(quantizeNumberFieldValue(parsed, step, min), min, max));
    }
  };

  const nudge = (direction: 1 | -1) => {
    const parsedDraft = draft == null ? Number.NaN : Number(draft.trim());
    const draftBase = Number.isNaN(parsedDraft)
      ? null
      : clamp(quantizeNumberFieldValue(parsedDraft, step, min), min, max);
    const base = draftBase ?? current ??
      (direction === 1 ? (min ?? 0) - step : (max ?? 0) + step);
    setDraft(null);
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
      inputMode={resolvedInputMode}
      role="spinbutton"
      aria-valuenow={current ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      disabled={disabled}
      value={draft ?? current ?? ""}
      onChange={handleChange}
      onBlur={handleBlur}
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
