import { cn } from "@/shared/utils/utils"

export function Root({ as, children, className, ...props }) {
  const Comp = as || "div"
  return (
    <Comp
      className={cn("flex flex-row items-center gap-3", className)}
      {...props}
    >
      {children}
    </Comp>
  )
}

export function Avatar({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "w-[42px] rounded-full overflow-hidden aspect-square relative shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function Info({ children, className, ...props }) {
  return (
    <div
      className={cn("flex flex-col items-start gap-1 min-w-0", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function Title({ children, className, ...props }) {
  return (
    <p className={cn("text-sm leading-snug", className)} {...props}>
      {children}
    </p>
  )
}

export function Subtitle({ children, className, ...props }) {
  return (
    <p
      className={cn(
        "leading-snug text-muted text-xs whitespace-nowrap text-ellipsis overflow-hidden w-full",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  )
}
