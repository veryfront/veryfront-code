/**
 * Card — flat surface primitive, forked dependency-light from Veryfront
 * Studio's `Card` (studio/components/Card). Solid (`bg-secondary`, no border,
 * no shadow) for interactive content; outline (`border-outline-border`, no bg)
 * for layout / non-interactive content. Both flat, radius baked in.
 *
 * Studio deps (cva/class-variance-authority, Heading/Text) are swapped for our
 * private `cva` and plain elements. Private to the chat module.
 *
 * @module react/components/chat/ui/card
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { cva, type VariantProps } from "./cva.ts";

const cardVariants = cva("w-full overflow-hidden", {
  variants: {
    surface: {
      // Studio: solid = bg-secondary (interactive), outline = border only.
      solid: "bg-[var(--secondary)]",
      outline: "border border-[var(--outline-border)]",
    },
    padding: {
      none: "",
      sm: "p-4",
      md: "p-5",
      lg: "p-6",
    },
    // Studio radius scale: default = lg (20px), sm = md (12px). Nested cards
    // read better at `sm` so they don't fight the outer chrome.
    radius: {
      default: "rounded-[var(--radius-lg)]",
      sm: "rounded-[var(--radius-md)]",
    },
  },
  defaultVariants: {
    surface: "solid",
    padding: "none",
    radius: "default",
  },
});

/** Props accepted by `<Card>`. */
export interface CardProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  ref?: React.Ref<HTMLDivElement>;
}

/** A flat card surface (Studio `Card`). */
export function Card(
  { className, surface, padding, radius, ref, ...props }: CardProps,
): React.ReactElement {
  return (
    <div
      ref={ref}
      className={cn(cardVariants({ surface, padding, radius }), className)}
      {...props}
    />
  );
}
Card.displayName = "Card";

/** Card header row — a flex row (Studio composes these inline). */
export function CardHeader(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  );
}
CardHeader.displayName = "Card.Header";

/** Card body region — vertical stack. */
export function CardContent(
  { className, ...props }: React.HTMLAttributes<HTMLDivElement>,
): React.ReactElement {
  return <div className={cn("flex flex-col", className)} {...props} />;
}
CardContent.displayName = "Card.Content";
