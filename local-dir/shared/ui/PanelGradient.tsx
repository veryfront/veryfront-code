import { cn } from "@/shared/utils/utils"

export function PanelGradient({ children, position = "bottom", className }) {
  return (
    <div className={cn("relative", className)}>
      {children}
      <div
        className={cn(
          "absolute inset-x-0 bg-highlight h-[400px] pointer-events-none -z-10",
          position === "bottom" && "bottom-0",
          position === "top" && "top-0 rotate-180",
        )}
        role="presentation"
      />
    </div>
  )
}
