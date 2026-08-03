/**
 * Label — ported 1:1 from Veryfront Studio, `vf-type/vf-weight` utilities
 * remapped to plain Tailwind weights/sizes. Private to the chat module.
 *
 * NOTE: the font-weight lives ONLY in the `weight` variant (default `medium`),
 * never in the base — veryfront's `cn`/`cva` do not Tailwind-merge, so a base
 * `font-medium` would survive alongside a `weight="normal"` `font-normal` and
 * win by source order, making every label bold. Studio can keep it in the base
 * because its `cn` uses tailwind-merge; we cannot.
 *
 * @module react/components/ui/label
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { cva, type VariantProps } from "./cva.ts";

const labelVariants = cva(
  [
    "block leading-none text-[var(--foreground)]",
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
  extends React.ComponentProps<"label">, VariantProps<typeof labelVariants> {
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
