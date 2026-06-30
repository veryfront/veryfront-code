/**
 * Radio — ported 1:1 from Veryfront Studio (which is already a native
 * `<input type="radio">`, so this is a faithful token remap with full native
 * a11y — focus, keyboard, form participation). Plus `RadioField` (label +
 * description) and `RadioGroup`. Private to the chat module.
 *
 * @module react/components/chat/ui/radio
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { Label } from "./label.tsx";

/** Props accepted by `<Radio>`. */
export interface RadioProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  ref?: React.Ref<HTMLInputElement>;
}

/** A single radio input. */
export function Radio(
  { className, ref, ...props }: RadioProps,
): React.ReactElement {
  return (
    <input
      ref={ref}
      type="radio"
      className={cn(
        "size-5 shrink-0 appearance-none rounded-full border border-[var(--outline-border)]",
        "bg-[var(--input-bg)] cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--edge-medium)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "checked:border-[var(--primary)] checked:bg-[var(--primary)] checked:shadow-[inset_0_0_0_4px] checked:shadow-[var(--secondary)]",
        "transition-colors",
        className,
      )}
      {...props}
    />
  );
}

/** Props accepted by `<RadioField>`. */
export interface RadioFieldProps extends RadioProps {
  label: React.ReactNode;
  description?: string;
}

/** A radio paired with a clickable label and optional description. */
export function RadioField({
  label,
  description,
  id,
  ref,
  ...props
}: RadioFieldProps): React.ReactElement {
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  return (
    <Label
      htmlFor={fieldId}
      weight="normal"
      className="cursor-pointer flex items-center gap-2.5"
    >
      <Radio id={fieldId} ref={ref} {...props} />
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

/** Vertical group of radios. */
export function RadioGroup(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div
      role="radiogroup"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}
