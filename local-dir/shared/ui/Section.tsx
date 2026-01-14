import { cn, cva } from "@/shared/utils/utils"

export function Root({ children, className, as, ...props }) {
  const Comp = as || "section"
  return (
    <Comp className={cn("py-12 md:py-20 xl:py-28", className)} {...props}>
      {children}
    </Comp>
  )
}

export const headerVariants = cva(
  "flex flex-col space-y-2.5 lg:space-y-4 mb-6 md:mb-8 lg:mb-10",
  {
    variants: {
      base: {
        left: "items-start text-left",
        center: "items-center text-center",
      },
      xs: {
        left: "xs:items-start xs:text-left",
        center: "xs:items-center xs:text-center",
      },
      md: {
        left: "md:items-start md:text-left",
        center: "md:items-center md:text-center",
      },
    },
    defaultVariants: {
      base: "left",
      xs: "left",
      md: "center",
    },
  },
)

export function Header({ children, layout, className }) {
  return (
    <div
      className={cn(
        headerVariants({
          base: layout?.base,
          xs: layout?.xs,
          md: layout?.md,
          className,
        }),
      )}
    >
      {children}
    </div>
  )
}

export function Title({ children, as, className }) {
  const Comp = as || "h2"
  return (
    <Comp
      className={cn(
        "font-display font-medium text-3xl md:text-4xl lg:text-5xl max-w-5xl",
        className,
      )}
    >
      {children}
    </Comp>
  )
}

export function Description({ children, className }) {
  return (
    <p className={cn("sm:text-lg lg:text-xl max-w-xl", className)}>
      {children}
    </p>
  )
}
