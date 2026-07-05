/**
 * Checkbox — Studio's Checkbox is built on `@radix-ui/react-checkbox`; here it's
 * re-expressed on a native `<input type="checkbox">` (full a11y for free — focus,
 * keyboard, form participation) with an overlaid check, keeping Studio's exact
 * box styling. Self-contained, no radix. Accepts the native API plus an optional
 * radix-style `onCheckedChange`. Plus `CheckboxField` + `CheckboxGroup`.
 *
 * @module react/components/chat/ui/checkbox
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { CheckIcon } from "../icons/index.ts";
import { Label } from "./label.tsx";

/** Props accepted by `<Checkbox>`. */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Radix-style convenience callback fired with the next checked state. */
  onCheckedChange?: (checked: boolean) => void;
  ref?: React.Ref<HTMLInputElement>;
}

/** A checkbox with an overlaid check indicator. */
export function Checkbox({
  className,
  onChange,
  onCheckedChange,
  ref,
  ...props
}: CheckboxProps): React.ReactElement {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "peer size-5 shrink-0 appearance-none rounded-[var(--radius-xs)] border border-[var(--outline-border)] dark:border-[var(--background)]",
          "bg-[var(--input-bg)] cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--edge-medium)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "checked:bg-[var(--primary)] checked:border-[var(--primary)]",
          "transition-colors",
          className,
        )}
        onChange={(e) => {
          onChange?.(e);
          onCheckedChange?.(e.currentTarget.checked);
        }}
        {...props}
      />
      <CheckIcon className="pointer-events-none absolute inset-0 m-auto size-3! text-[var(--secondary)] opacity-0 peer-checked:opacity-100" />
    </span>
  );
}

/** Props accepted by `<CheckboxField>`. */
export interface CheckboxFieldProps extends CheckboxProps {
  label: React.ReactNode;
  description?: string;
}

/** A checkbox paired with a clickable label and optional description. */
export function CheckboxField({
  label,
  description,
  id,
  ref,
  ...props
}: CheckboxFieldProps): React.ReactElement {
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  return (
    <Label
      htmlFor={fieldId}
      weight="normal"
      className="cursor-pointer flex items-center gap-2.5"
    >
      <Checkbox id={fieldId} ref={ref} {...props} />
      <span className="flex flex-col">
        <span className={cn(description && "mb-1")}>{label}</span>
        {description && (
          <span className="text-base font-normal text-[var(--foreground)]">
            {description}
          </span>
        )}
      </span>
    </Label>
  );
}

/** Vertical group of checkboxes. */
export function CheckboxGroup(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}
