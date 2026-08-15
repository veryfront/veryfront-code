/**
 * InputOTP: a segmented one-time-code input. A single visually-hidden real
 * `<input>` (numeric, `autocomplete="one-time-code"`) captures typing and paste,
 * while `maxLength` presentational slots mirror each character of the controlled
 * `value`. The slot at the caret position gets a focus ring; when the code is
 * complete, the final slot stays active. Fully controlled and self-contained (no
 * floating engine, no dependencies); skinned with the veryfront theme tokens.
 *
 * @example
 * ```tsx
 * import { InputOTP } from "veryfront/ui";
 *
 * function Verify() {
 *   const [code, setCode] = React.useState("");
 *   return <InputOTP value={code} onChange={setCode} maxLength={6} />;
 * }
 * ```
 *
 * @module react/components/ui/input-otp
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<InputOTP>`. */
export interface InputOTPProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** The controlled code. Only the first `maxLength` characters are displayed. */
  value: string;
  /** Fires with the next sanitized (digits-only, clamped to `maxLength`) code. */
  onChange?: (value: string) => void;
  /** Number of slots (and the input's max length). @default 6 */
  maxLength?: number;
  /** Disable typing and dim the slots. @default false */
  disabled?: boolean;
  /** React 19: ref is a regular prop. Forwarded to the hidden `<input>`. */
  ref?: React.Ref<HTMLInputElement>;
}

/** Render a segmented one-time-code input. */
export function InputOTP({
  value,
  onChange,
  maxLength = 6,
  disabled = false,
  className,
  ref,
  "aria-label": ariaLabel = "One-time code",
  ...props
}: InputOTPProps): React.ReactElement {
  // One sanitized value drives both the input and the slots. Without this a
  // caller passing a longer or non-digit `value` puts the input out of step
  // with the rendered slots, and `active` lands past the last slot so no
  // caret ring shows.
  const code = value.replace(/\D/g, "").slice(0, maxLength);
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value.replace(/\D/g, "").slice(0, maxLength);
    onChange?.(next);
  };
  const activeIndex = Math.min(code.length, maxLength - 1);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-disabled={disabled ? "" : undefined}
      className={cn("relative inline-flex items-center gap-2", className)}
      {...props}
    >
      {/* The real input overlays the slots so a pointer/paste lands here. */}
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        disabled={disabled}
        // The input is what receives focus, so it carries the name itself. The
        // group label alone is not announced for the focused control.
        aria-label={ariaLabel}
        value={code}
        onChange={handleChange}
        className="absolute inset-0 z-10 h-full w-full cursor-default opacity-0 disabled:cursor-not-allowed"
      />
      {Array.from({ length: maxLength }, (_, index) => {
        const char = code[index] ?? "";
        const active = index === activeIndex;
        return (
          <div
            key={index}
            data-slot={index}
            data-active={active ? "" : undefined}
            data-filled={char ? "" : undefined}
            className={cn(
              "flex size-10 items-center justify-center rounded-md border text-center text-sm",
              "border-[var(--border)] text-[var(--foreground)]",
              active && "ring-2 ring-[var(--ring)]",
              disabled && "opacity-50",
            )}
          >
            {char}
          </div>
        );
      })}
    </div>
  );
}
