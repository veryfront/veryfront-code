import { cn } from "@/shared/utils/utils"
import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1?external=react,react-dom"
import React from "react"

export const IconButton = React.forwardRef(
  ({ children, className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : props.href ? "a" : "button"
    return (
      <Comp
        className={cn(
          "p-2.5 rounded text-foreground hover:text-muted focus:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background flex items-center justify-center",
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    )
  },
)
