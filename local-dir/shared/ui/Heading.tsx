import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1"
import React from "react"
import { cn, cva } from "@/shared/utils/utils"

const headingVariants = cva("font-display subpixel-antialiased text-balance", {
  variants: {
    level: {
      1: "font-semibold text-[1.7rem] xs:text-3xl md:text-4xl lg:text-5xl !leading-[1.15] font-sans",
      2: "font-medium text-xl lg:text-[24px] !leading-tight font-sans",
      3: "font-medium lg:text-lg !leading-tight font-sans",
      4: "font-medium !leading-tight font-sans",
    },
  },
  defaultVariants: {
    level: "1",
  },
})
interface HeadingProps {
  children: React.ReactNode
  asChild?: boolean
  as?: string
  level?: "1" | "2" | "3"
  className?: string
}
export function Heading({ children, asChild, as = "h1", level, className }) {
  const Comp = asChild ? Slot : as || "p"
  return (
    <>
      <Comp
        className={cn(
          headingVariants({
            level,
            className,
          }),
        )}
      >
        {children}
      </Comp>
    </>
  )
}
