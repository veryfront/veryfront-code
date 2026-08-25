/**
 * Slider - pick a number from a range by dragging a thumb along a track.
 *
 * A single native `<input type="range">` (so keyboard, focus, and ARIA come for
 * free) restyled with the veryfront theme tokens. Controlled via
 * `value`/`onValueChange` or uncontrolled via `defaultValue`; `min`/`max`/`step`
 * behave as on the native element. No adapter or engine required.
 *
 * @example Uncontrolled, 0-100
 * ```tsx
 * import { Slider } from "veryfront/ui";
 *
 * <Slider defaultValue={50} aria-label="Volume" />;
 * ```
 *
 * @example Controlled with a step
 * ```tsx
 * const [temp, setTemp] = React.useState(20);
 * <Slider value={temp} onValueChange={setTemp} min={16} max={30} step={0.5} />;
 * ```
 *
 * @module react/components/ui/slider
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<Slider>`. */
export interface SliderProps extends
  Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange"
  > {
  /** Controlled value (pair with `onValueChange`). */
  value?: number;
  /** Initial value when uncontrolled. */
  defaultValue?: number;
  /** Fires with the next value as the thumb moves. */
  onValueChange?: (value: number) => void;
  /** Lowest selectable value. @default 0 */
  min?: number;
  /** Highest selectable value. @default 100 */
  max?: number;
  /** Granularity the value snaps to. @default 1 */
  step?: number;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLInputElement>;
}

// Native range thumbs must be styled per-vendor, and each Tailwind utility needs
// its own pseudo-element variant prefix (a prefix applies to one class only).
const WEBKIT_THUMB = "[&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-4 " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:bg-[var(--primary)] [&::-webkit-slider-thumb]:cursor-pointer";
const MOZ_THUMB =
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 " +
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--primary)] " +
  "[&::-moz-range-thumb]:cursor-pointer";

/** Render a range slider. */
export function Slider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  className,
  disabled,
  ref,
  ...props
}: SliderProps): React.ReactElement {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onValueChange?.(Number(event.target.value));
  };

  return (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      defaultValue={value === undefined ? defaultValue : undefined}
      disabled={disabled}
      onChange={handleChange}
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "w-full cursor-pointer appearance-none bg-transparent",
        // WebKit track + thumb
        "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--edge)]",
        WEBKIT_THUMB,
        // Firefox track + thumb
        "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--edge)]",
        MOZ_THUMB,
        // Focus ring on the thumb
        "focus-visible:outline-none",
        "[&:focus-visible::-webkit-slider-thumb]:ring-2 [&:focus-visible::-webkit-slider-thumb]:ring-[var(--edge-medium)]",
        "[&:focus-visible::-moz-range-thumb]:ring-2 [&:focus-visible::-moz-range-thumb]:ring-[var(--edge-medium)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
