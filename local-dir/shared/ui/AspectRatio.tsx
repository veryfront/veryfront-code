import { cn } from "@/shared/utils/utils"

export function AspectRatio({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "aspect-video flex items-center justify-center relative w-full bg-panel text-panel-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
