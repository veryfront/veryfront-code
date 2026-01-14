import { cn, cva } from "@/shared/utils/utils"

export const containerVariants = cva("container", {
  variants: {
    size: {
      xs: "max-w-3xl",
      sm: "max-w-4xl",
      md: "max-w-[1360px]",
      lg: "max-w-[1700px]",
    },
  },

  defaultVariants: {
    size: "md",
  },
})

export function Container({ children, size, className }) {
  return (
    <div className={cn(containerVariants({ size, className }))}>{children}</div>
  )
}
