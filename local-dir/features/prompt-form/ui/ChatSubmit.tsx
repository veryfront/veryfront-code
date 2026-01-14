import { cn, cva } from "@/shared/utils/utils"
import React from "react"

type VariantProps = any

const chatSubmitVariants = cva(
  "rounded-full size-9 inline-flex items-center justify-center disabled:opacity-100 disabled:cursor-not-allowed transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0 focus-visible:ring-offset-background shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border border-input-border hover:border-primary focus:border-primary hover:bg-primary focus:bg-primary hover:text-primary-foreground focus:text-primary-foreground",
        secondary:
          "border border-transparent text-muted bg-transparent hover:border-secondary focus:border-secondary hover:bg-secondary focus:bg-secondary",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
)

interface ChatSubmitProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chatSubmitVariants> {
  children: React.ReactNode
}

export const ChatSubmit = React.forwardRef<HTMLButtonElement, ChatSubmitProps>(
  ({ className, variant, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(chatSubmitVariants({ variant }), className)}
        {...props}
      >
        {children}
      </button>
    )
  },
)
