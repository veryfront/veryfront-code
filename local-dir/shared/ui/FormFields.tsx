import { cn } from "@/shared/utils/utils"

export function FormFields({ children, className }) {
  return <div className={cn("flex flex-col gap-6", className)}>{children}</div>
}

export function FormField({ children, className }) {
  return <div className={cn("flex flex-col gap-3", className)}>{children}</div>
}

export function FormFieldCols({ children, className }) {
  return (
    <div className={cn("grid gap-6 lg:grid-cols-2 w-full", className)}>
      {children}
    </div>
  )
}
