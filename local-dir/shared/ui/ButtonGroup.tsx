import { cn, cva } from "@/shared/utils/utils"

const buttonGroupVariants = cva("flex flex-wrap gap-3", {
  variants: {
    base: {
      start: "flex-row justify-start",
      stretch: "flex-col items-stretch",
      center: "flex-row justify-center",
    },
    xs: {
      start: "xs:flex-row xs:justify-start",
      stretch: "xs:flex-col xs:items-stretch",
      center: "xs:flex-row xs:justify-center",
    },
    sm: {
      start: "sm:flex-row sm:justify-start",
      stretch: "sm:flex-col sm:items-stretch",
      center: "sm:flex-row sm:justify-center",
    },
    md: {
      start: "md:flex-row md:justify-start",
      stretch: "md:flex-col md:items-stretch",
      center: "md:flex-row md:justify-center",
    },
    lg: {
      start: "lg:flex-row lg:justify-start",
      stretch: "lg:flex-col lg:items-stretch",
      center: "lg:flex-row lg:justify-center",
    },
  },
  defaultVariants: {
    base: "stretch",
    xs: "start",
  },
})

export function ButtonGroup({ children, layout, className }) {
  return (
    <div
      className={cn(
        buttonGroupVariants({
          base: layout?.base,
          xs: layout?.xs,
          md: layout?.md,
          lg: layout?.lg,
          className,
        }),
      )}
    >
      {children}
    </div>
  )
}
