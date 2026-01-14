import { cn } from "@/shared/utils/utils"
import React from "react"

export const Textarea = React.forwardRef(
  ({ className, as = "textarea", ...props }, ref) => {
    const Component = as || "textarea"

    return (
      <Component
        className={cn(
          "bg-input border border-border/80 dark:border-border focus:border-input-border p-3 block w-full text-base rounded-md focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 placeholder:input-placeholder",
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
