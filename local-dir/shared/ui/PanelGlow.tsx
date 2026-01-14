import { cn } from "@/shared/utils/utils"
import React from "react"

export function Glow({ side = "bottom" }) {
  return (
    <div
      className={cn(
        "absolute opacity-75 pointer-events-none",
        side === "bottom" && "bottom-0",
        side === "top-outer" && "bottom-full",
        side === "top" && "top-0 rotate-180",
        side === "bottom-outer" && "top-full rotate-180",
        (side === "top" ||
          side === "top-outer" ||
          side === "bottom" ||
          side === "bottom-outer") &&
          "h-10 bg-glow-vertical left-[10%] right-[10%] md:left-[15%] md:right-[15%] lg:left-[25%] lg:right-[25%] ",
        (side === "left" ||
          side === "left-outer" ||
          side === "right" ||
          side === "right-outer") &&
          "w-10 bg-glow-horizontal top-[5%] bottom-[5%] md:top-[10%] md:bottom-[10%] lg:top-[10%] lg:bottom-[10%]",
        side === "right" && "right-0",
        side === "left-outer" && "right-full",
        side === "left" && "left-0 rotate-180",
        side === "right-outer" && "left-full rotate-180",
      )}
      role="presentation"
    />
  )
}

export const PanelGlow = React.forwardRef(
  ({ children, sides = ["bottom"], className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("relative", className)} {...props}>
        {children}
        <div>
          {sides?.map((side) => {
            return <Glow key={side} side={side} />
          })}
        </div>
      </div>
    )
  },
)
