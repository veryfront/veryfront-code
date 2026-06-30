/**
 * Input — ported from Veryfront Studio (`inputStyles` cva + optional leading
 * icon), semantic classes remapped to veryfront's `[var(--token)]` vocabulary.
 * Studio's `type="date"` DateInput branch is omitted for v1. Private to the
 * chat module.
 *
 * @module react/components/chat/ui/input
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { cva, type VariantProps } from "./cva.ts";

const inputVariants = cva(
  [
    "flex w-full text-[var(--foreground)]",
    "placeholder:text-[var(--foreground)] placeholder:opacity-25",
    "transition-[background-color,box-shadow,border-color] duration-150 ease-in",
    "focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "bg-[var(--input-bg)] border border-[var(--background)] dark:border-transparent",
    // veryfront has no --status-error token yet; fall back to --destructive.
    "data-[invalid=true]:border-[var(--destructive)]",
  ],
  {
    variants: {
      size: {
        sm: "h-[38px] px-3 text-base rounded-md",
        md: "h-[42px] px-3 text-base rounded-md",
        lg: "h-[48px] px-4 text-base rounded-md",
      },
    },
    defaultVariants: { size: "lg" },
  },
);

/** Props accepted by `<Input>`. */
export interface InputProps
  extends
    Omit<React.ComponentProps<"input">, "size">,
    VariantProps<typeof inputVariants> {
  ref?: React.Ref<HTMLInputElement>;
  /** Leading icon rendered inside the field. */
  icon?: React.ReactNode;
  "data-invalid"?: boolean | "true" | "false";
}

/** Render a text input. */
export function Input({
  className,
  type,
  size,
  icon,
  ref,
  "data-invalid": dataInvalid,
  ...props
}: InputProps): React.ReactElement {
  if (icon) {
    const isSm = size === "sm";
    return (
      <div
        className={cn(
          inputVariants({ size }),
          "relative flex items-center px-0",
          isSm ? "pl-3 pr-3" : "pl-3.5 pr-4",
          "gap-2",
          className,
        )}
        data-invalid={dataInvalid}
      >
        <span className="shrink-0 pointer-events-none text-[var(--foreground)]">
          {icon}
        </span>
        <input
          type={type}
          className="flex-1 min-w-0 bg-transparent text-inherit placeholder:text-[var(--foreground)] placeholder:opacity-25 outline-none border-0 p-0 h-full"
          data-invalid={dataInvalid}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
  return (
    <input
      type={type}
      className={cn(inputVariants({ size }), className)}
      data-invalid={dataInvalid}
      ref={ref}
      {...props}
    />
  );
}

export { inputVariants };
