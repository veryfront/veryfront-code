/**
 * Switch — Studio's Switch is built on `@radix-ui/react-switch`; here it's
 * re-expressed on a native `<input type="checkbox" role="switch">` (full a11y
 * for free) styled as a track + thumb, keeping Studio's exact sizes and
 * transitions. Self-contained, no radix. Accepts the native API plus an
 * optional radix-style `onCheckedChange`. Plus `SwitchField`.
 *
 * @module react/components/ui/switch
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { cva, type VariantProps } from "./cva.ts";
import { Label } from "./label.tsx";

const switchTrackVariants = cva(
  [
    "relative inline-flex items-center shrink-0 cursor-pointer rounded-full transition-colors",
    "border border-[var(--background)] dark:border-transparent",
    "bg-[var(--input-bg)] has-[:checked]:bg-[var(--primary)]",
    "has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-[var(--edge-medium)]",
    "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
  ],
  {
    variants: {
      size: { sm: "h-6 w-10", md: "h-7 w-12", lg: "h-8 w-14" },
    },
    defaultVariants: { size: "md" },
  },
);

const switchThumbVariants = cva(
  [
    "pointer-events-none block rounded-full transition-transform duration-200 translate-x-0.5",
    "bg-[var(--background)] peer-checked:bg-[var(--secondary)]",
  ],
  {
    variants: {
      size: {
        sm: "size-4 peer-checked:translate-x-[18px]",
        md: "size-5 peer-checked:translate-x-[22px]",
        lg: "size-6 peer-checked:translate-x-[26px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

/** Props accepted by `<Switch>`. */
export interface SwitchProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size">,
    VariantProps<typeof switchTrackVariants> {
  /** Radix-style convenience callback fired with the next checked state. */
  onCheckedChange?: (checked: boolean) => void;
  ref?: React.Ref<HTMLInputElement>;
}

/** A toggle switch. */
export function Switch({
  className,
  size,
  onChange,
  onCheckedChange,
  ref,
  ...props
}: SwitchProps): React.ReactElement {
  return (
    <label className={cn(switchTrackVariants({ size }), className)}>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        className="peer sr-only"
        onChange={(e) => {
          onChange?.(e);
          onCheckedChange?.(e.currentTarget.checked);
        }}
        {...props}
      />
      <span className={switchThumbVariants({ size })} />
    </label>
  );
}

/** Props accepted by `<SwitchField>`. */
export interface SwitchFieldProps extends SwitchProps {
  label: React.ReactNode;
  description?: string;
}

/** A switch with a label + optional description, label-left / switch-right. */
export function SwitchField({
  label,
  description,
  id,
  ref,
  ...props
}: SwitchFieldProps): React.ReactElement {
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  return (
    <div className="flex items-center justify-between gap-4">
      <Label
        htmlFor={fieldId}
        className="cursor-pointer flex flex-col flex-1"
      >
        <span className="mb-1.5">{label}</span>
        {description && (
          <span className="text-sm font-normal text-[var(--foreground)]">
            {description}
          </span>
        )}
      </Label>
      <Switch id={fieldId} size="sm" ref={ref} {...props} />
    </div>
  );
}

export { switchTrackVariants };
