import { Container } from "@/shared/ui/Container"
import { cn } from "@/shared/utils/utils"

export function Root({ className, ...props }) {
  return (
    <div
      className={cn("pt-10 md:pt-12 pb-16 md:pb-20", className)}
      {...props}
    />
  )
}

export function Grid({ className, ...props }) {
  return (
    <div
      className={cn(
        "grid gap-6 sm:gap-x-8 lg:gap-10 sm:grid-cols-2 md:grid-cols-3",
        className,
      )}
      {...props}
    />
  )
}

export function Item({ className, ...props }) {
  return (
    <article
      className={cn("flex gap-5 items-start max-md:max-w-sm", className)}
      {...props}
    />
  )
}

export function Content({ className, ...props }) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 md:gap-2.5", className)}
      {...props}
    />
  )
}

export function Title({ className, ...props }) {
  return (
    <h3
      className={cn(
        "font-medium leading-tight lg:text-lg lg:leading-tight",
        className,
      )}
      {...props}
    />
  )
}

export function Description({ className, ...props }) {
  return <p className={cn("text-[0.9rem]", className)} {...props} />
}

export function Image({ className, ...props }) {
  return <img className={cn("shrink-0", className)} {...props} />
}

export function CircleIcon({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-full bg-background border border-border w-12 h-12 lg:w-16 lg:h-16 flex items-center justify-center shrink-0",
        className,
      )}
      {...props}
    />
  )
}
