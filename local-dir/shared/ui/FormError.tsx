import { cn } from "@/shared/utils/utils"

export function FormError({ children, className }) {
  if (!children) {
    return null
  }

  return (
    <p
      className={cn(
        "text-xs font-medium text-red-600 dark:text-red-500",
        className,
      )}
    >
      {children}
    </p>
  )
}
