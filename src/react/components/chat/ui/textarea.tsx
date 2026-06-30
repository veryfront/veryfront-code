/**
 * Textarea — ported 1:1 from Veryfront Studio, semantic classes remapped to
 * veryfront's `[var(--token)]` vocabulary. Private to the chat module.
 *
 * @module react/components/chat/ui/textarea
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { cva, type VariantProps } from "./cva.ts";

const textareaVariants = cva(
  [
    "flex w-full text-[var(--foreground)]",
    "placeholder:text-[var(--foreground)] placeholder:opacity-25",
    "transition-[background-color,box-shadow,border-color] duration-150 ease-in",
    "focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "resize-none",
    "rounded-md bg-[var(--input-bg)] border border-[var(--background)] dark:border-transparent",
    // veryfront has no --status-error token yet; fall back to --destructive.
    "data-[invalid=true]:border-[var(--destructive)]",
  ],
  {
    variants: {
      size: {
        default: "min-h-32 md:min-h-28 px-4 py-3 text-base",
        sm: "min-h-20 px-3 py-2 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

/** Props accepted by `<Textarea>`. */
export interface TextareaProps
  extends
    Omit<React.ComponentProps<"textarea">, "size">,
    VariantProps<typeof textareaVariants> {
  ref?: React.Ref<HTMLTextAreaElement>;
}

/** Render a textarea. */
export function Textarea(
  { className, size, ref, ...props }: TextareaProps,
): React.ReactElement {
  return (
    <textarea
      className={cn(textareaVariants({ size }), className)}
      ref={ref}
      {...props}
    />
  );
}

export { textareaVariants };
