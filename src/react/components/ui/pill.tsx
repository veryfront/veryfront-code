/**
 * Pill — ported 1:1 from Veryfront Studio. A filled trigger pill (label +
 * optional icon/chevron) for selection triggers — "click to open / select"
 * rather than "click to act". Surface-paired via the `on` prop, matching
 * Button's surface system. Semantic classes remapped to veryfront's
 * `[var(--token)]` vocabulary; icon glyphs sized a half-step down. Private to
 * the chat module.
 *
 * @module react/components/ui/pill
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { cva, type VariantProps } from "./cva.ts";

const pillVariants = cva(
  [
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-normal text-[var(--foreground)]",
    "cursor-pointer select-none outline-none transition-colors",
    "focus-visible:bg-[var(--accent)]",
    "[&_svg]:size-3.5 [&_svg]:shrink-0",
  ],
  {
    variants: {
      /**
       * Surface the pill sits on. `chrome` (default) on the sand background,
       * `card` on a white card surface. Hover is a soft bump, not a polarity
       * flip — pills are passive triggers, not actions.
       */
      on: {
        chrome: "bg-[var(--accent)] hover:bg-[var(--accent)]",
        card: "bg-[var(--tertiary)] hover:bg-[var(--accent)]",
      },
    },
    defaultVariants: {
      on: "chrome",
    },
  },
);

/** Props accepted by `<Pill>`. */
export interface PillProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    VariantProps<typeof pillVariants> {
  ref?: React.Ref<HTMLButtonElement>;
}

/** Render a selection-trigger pill. */
export function Pill(
  { className, on, ref, ...props }: PillProps,
): React.ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(pillVariants({ on }), className)}
      {...props}
    />
  );
}

export { pillVariants };
