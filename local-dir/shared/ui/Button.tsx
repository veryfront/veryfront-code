import { cn, cva } from "@/shared/utils/utils"
import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1"
import React from "react"
import { LoadingIcon } from "@/shared/ui/LoadingIcon"

export const buttonVariants = cva(
  "inline-flex items-center gap-2.5 justify-center flex-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-80 disabled:pointer-events-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background relative active:scale-[0.97] transition-[transform] duration-150 touch-manipulation",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground border border-transparent hover:bg-primary/90 focus:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/90 focus:bg-secondary/90",
        outline:
          "border border-border hover:border-primary focus:border-primary",
        destructive:
          "border border-destructive text-destructive hover:bg-destructive/90 focus:bg-destructive/90 hover:text-destructive-foreground focus:text-destructive-foreground",
        icon: "text-muted hover:text-foreground focus:text-foreground border border-transparent focus:border focus:border-foreground/30",
        unstyled: "",
        link: "bg-transparent text-primary hover:bg-secondary/90 focus:bg-secondary/90",
      },
      size: {
        xs: "text-xs h-7 px-3",
        sm: "text-sm h-8 px-3.5",
        md: "text-sm h-9 px-4",
        lg: "h-10 px-5",
        xl: "h-12 px-5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
    compoundVariants: [
      {
        variant: "icon",
        class: "p-0 size-[1.825rem]",
      },
      {
        variant: "unstyled",
        class: "p-0 h-auto",
      },
    ],
  },
)

export const Button = React.forwardRef(
  ({ className, variant, size, animation, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, animation, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)

export const LoadingButton = React.forwardRef(
  (
    {
      children,
      isLoading,
      loadingText = "Loading...",
      isFixed = true,
      ...props
    },
    ref,
  ) => {
    return (
      <Button ref={ref} {...props}>
        <span
          className={cn(
            "flex items-center justify-center gap-2.5",
            isFixed && "opacity-0 absolute inset-0",
            isFixed && isLoading && "opacity-100",
            !isFixed && !isLoading && "hidden",
          )}
          aria-hidden={!isLoading}
          aria-label={loadingText}
        >
          <LoadingIcon className="size-3.5 animate-spin shrink-0" />{" "}
          {loadingText}
        </span>
        <span
          aria-hidden={isLoading}
          className={cn(
            "inline-flex items-center gap-2.5",
            isFixed && isLoading && "opacity-0",
            !isFixed && isLoading && "hidden",
          )}
        >
          {children}
        </span>
      </Button>
    )
  },
)
