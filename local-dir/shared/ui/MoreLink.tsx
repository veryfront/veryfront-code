import { cn } from "@/shared/utils/utils"
import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1"
import { ChevronRight } from "https://esm.sh/lucide-react"
import React from "react"

interface MoreLinkProps {
  children: React.ReactNode
  asChild?: boolean
  as?: string
  className?: string
}

export function MoreLink({ children, asChild, as = "a", className, ...props }) {
  const Comp = asChild ? Slot : as || "a"

  return (
    <a
      {...props}
      className={cn(
        "font-medium inline-flex gap-1.5 text-sm text-primary items-center underline-offset-8 hover:underline focus:text-muted active:scale-[0.97] transition-[transform] duration-150 touch-manipulation whitespace-nowrap",
        className,
      )}
    >
      {children} <ChevronRight className="size-4 text-primary" />
    </a>
  )
}
