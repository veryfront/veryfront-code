import { slugify, cn } from "@/shared/utils/utils"

export function Lead({ children, className }) {
  return (
    <p className={cn("text-lg md:text-xl font-normal", className)}>
      {children}
    </p>
  )
}
