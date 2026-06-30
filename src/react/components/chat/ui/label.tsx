/**
 * Label — ported 1:1 from Veryfront Studio, `vf-type/vf-weight` utilities
 * remapped to plain Tailwind weights/sizes. Private to the chat module.
 *
 * @module react/components/chat/ui/label
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { cva, type VariantProps } from "./cva.ts";

const labelVariants = cva(
  [
    "block font-medium leading-none text-[var(--foreground)]",
    "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  ],
  {
    variants: {
      size: {
        default: "text-sm",
        sm: "text-sm",
        xs: "text-xs",
      },
      weight: {
        normal: "font-normal",
        medium: "font-medium",
      },
    },
    defaultVariants: {
      size: "default",
      weight: "medium",
    },
  },
);

/** Props accepted by `<Label>`. */
export interface LabelProps
  extends
    React.ComponentProps<"label">,
    VariantProps<typeof labelVariants> {
  ref?: React.Ref<HTMLLabelElement>;
}

/** Render a form label. */
export function Label(
  { className, size, weight, ref, ...props }: LabelProps,
): React.ReactElement {
  return (
    <label
      className={cn(labelVariants({ size, weight }), className)}
      ref={ref}
      {...props}
    />
  );
}

export { labelVariants };
