import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1"
import React from "react"
import { cn, cva } from "@/shared/utils/utils"

const textVariants = cva("t", {
  variants: {
    level: {
      lead: "text-lg md:text-xl",
      1: "md:text-lg lg:text-xl",
      2: "lg:text-lg",
      3: "",
    },
  },
  defaultVariants: {
    level: "2",
  },
})

interface TextProps {
  children: React.ReactNode
  asChild?: boolean
  as?: string
  level?: "1" | "2"
  className?: string
}

export function Text({ children, asChild, as = "p", level, className }) {
  const Comp = asChild ? Slot : as || "p"
  return (
    <Comp className={cn(textVariants({ level, className }))}>{children}</Comp>
  )
}
