/**
 * Button — ported 1:1 from the Veryfront Studio `Button` primitive. Studio's
 * semantic Tailwind classes (`bg-primary`, `vf-type-base`, `vf-weight-normal`)
 * are mechanically remapped to veryfront's arbitrary-value vocabulary
 * (`bg-[var(--primary)]`, `text-base`, `font-normal`) — a deterministic token
 * mapping, not a redesign. Private to the chat module.
 *
 * Hover rule: every variant converges to primary/secondary on hover; primary
 * inverts the other way; destructive deepens; outline drops its border; link
 * drops underline. Loading keeps the label, sets `aria-busy` + `disabled`, and
 * applies a subtle opacity pulse.
 *
 * @module react/components/chat/ui/button
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { cva, type VariantProps } from "./cva.ts";
import { Slot } from "./slot.tsx";

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "font-normal rounded-full",
    "transition-[background-color,color,border-color] duration-150 ease-in",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--secondary)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
        secondary:
          "bg-[var(--secondary)] text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-[var(--secondary)]",
        tertiary:
          "text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-[var(--secondary)]",
        outline:
          "border border-[var(--outline-border)] dark:border-[var(--faint)] bg-transparent text-[var(--foreground)] hover:bg-[var(--accent)] hover:border-transparent",
        destructive:
          "bg-[var(--destructive)] text-white hover:bg-[color-mix(in_oklch,var(--destructive),black_18%)]",
        link:
          "text-[var(--foreground)] underline underline-offset-4 hover:no-underline !px-0 !gap-2",
        ghost: "bg-transparent text-[var(--foreground)]",
        text:
          "bg-transparent text-[var(--foreground)] hover:text-[var(--foreground)] !h-auto !w-auto !p-0 !justify-start !gap-1.5 [&_svg]:!mr-0",
        "icon-primary":
          "bg-[var(--primary)] text-[var(--secondary)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] !p-0 !gap-0 !justify-center",
        "icon-ghost":
          "bg-transparent text-[var(--foreground)] !p-0 !gap-0 !justify-center",
        "icon-secondary":
          "bg-[var(--secondary)] text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-[var(--secondary)] !p-0 !gap-0 !justify-center",
        "icon-tertiary":
          "text-[var(--foreground)] hover:bg-[var(--primary)] hover:text-[var(--secondary)] !p-0 !gap-0 !justify-center",
      },
      /**
       * Surface the button sits on — drives surface-paired hover for ghost /
       * icon-ghost / primary / icon-primary via compound variants. Default
       * `chrome`; pass `card` inside white card surfaces.
       */
      on: {
        chrome: "",
        card: "",
      },
      iconAfter: {
        true: "[&_svg]:ml-3.5 has-[svg]:justify-between",
      },
      size: {
        sm: "h-[32px] px-3.5 text-sm [&_svg]:size-3.5",
        default: "h-[38px] px-4.5 text-base [&_svg]:size-3.5",
        lg: "h-[48px] px-6 text-base [&_svg]:size-4.5",
        "icon-sm": "size-7 [&_svg]:size-3.5",
        "icon-default": "size-8 [&_svg]:size-3.5",
        "icon-lg": "size-9 [&_svg]:size-4.5",
        "icon-xl": "size-[38px] [&_svg]:size-3.5",
      },
    },
    compoundVariants: [
      { variant: "tertiary", on: "chrome", class: "bg-[var(--accent)]" },
      { variant: "icon-tertiary", on: "chrome", class: "bg-[var(--accent)]" },
      { variant: "ghost", on: "chrome", class: "hover:bg-[var(--accent)]" },
      { variant: "ghost", on: "card", class: "hover:bg-[var(--tertiary)]" },
      { variant: "icon-ghost", on: "chrome", class: "hover:bg-[var(--accent)]" },
      {
        variant: "icon-ghost",
        on: "card",
        class: "hover:bg-[var(--tertiary)]",
      },
      {
        variant: "primary",
        on: "card",
        class: "hover:bg-[var(--tertiary)] hover:text-[var(--foreground)]",
      },
      {
        variant: "icon-primary",
        on: "card",
        class: "hover:bg-[var(--tertiary)] hover:text-[var(--foreground)]",
      },
    ],
    defaultVariants: {
      variant: "primary",
      on: "chrome",
      size: "default",
    },
  },
);

/** Props accepted by `<Button>`. */
export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as a Radix-style Slot, merging props onto the child element. */
  asChild?: boolean;
  /** Slide the icon right on hover. */
  animateIcon?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Render an action button. */
export function Button({
  className,
  variant,
  size,
  iconAfter,
  on,
  asChild = false,
  animateIcon = false,
  type,
  ref,
  ...props
}: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        buttonVariants({ variant, size, iconAfter, on, className }),
        animateIcon &&
          "group [&_svg]:transition-transform [&_svg]:group-hover:translate-x-0.5",
      )}
      ref={ref}
      type={asChild ? type : (type ?? "button")}
      {...props}
    />
  );
}

/** Props accepted by `<LoadingButton>`. */
export interface LoadingButtonProps extends ButtonProps {
  /** Pending state — applies the opacity pulse, sets `aria-busy`, disables. */
  isLoading: boolean;
}

/** Button that pulses subtly while pending and blocks double-submits. */
export function LoadingButton({
  children,
  isLoading,
  disabled,
  className,
  ref,
  ...props
}: LoadingButtonProps): React.ReactElement {
  return (
    <Button
      ref={ref}
      disabled={isLoading || disabled}
      aria-busy={isLoading || undefined}
      className={cn(isLoading && "animate-button-loading", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export { buttonVariants };
