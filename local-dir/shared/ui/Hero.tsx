import { Container } from "@/shared/ui/Container"
import { cn, cva } from "@/shared/utils/utils"
import * as Section from "@/shared/ui/Section"

export function Root({ children, className }) {
  return (
    <Section.Root className={cn("py-8 md:py-12 xl:py-16", className)}>
      {children}
    </Section.Root>
  )
}

export const wrapperVariants = cva(
  "px-0 md:px-6 grid grid-cols-[1fr] gap-y-6 items-center",
  {
    variants: {
      variant: {
        row: "md:grid-cols-[repeat(24,1fr)]",
        column: "md:gap-y-10",
      },
    },
    defaultVariants: {
      variant: "row",
    },
  },
)

export function Wrapper({ children, variant, className }) {
  return (
    <Container
      className={cn(
        wrapperVariants({
          variant,
          className,
        }),
      )}
    >
      {children}
    </Container>
  )
}

export const contentVariants = cva("grid items-center px-4 md:px-0", {
  variants: {
    base: {
      top: "row-start-1 col-span-24",
      bottom: "row-start-2 col-span-24",
    },
    md: {
      start: "md:row-start-1 md:col-[1_/_span_12] md:pr-6 lg:pr-8",
      end: "md:row-start-1 md:col-[13_/_span_12] md:pl-6 lg:pl-8",
      top: "row-start-1 col-span-24",
      bottom: "row-start-2 col-span-24",
    },
  },
  defaultVariants: {
    base: "bottom",
    md: "start",
  },
})

export function Content({ children, layout, className }) {
  return (
    <div
      className={cn(
        contentVariants({
          base: layout?.base,
          md: layout?.md,
          className,
        }),
      )}
    >
      {children}
    </div>
  )
}

export const contentWrapperVariants = cva(
  "flex flex-1 flex-col gap-4 md:gap-5",
  {
    variants: {
      base: {
        start: "items-start text-left",
        center: "items-center text-center",
      },
      xs: {
        start: "xs:items-start xs:text-left",
        center: "xs:items-center xs:text-center",
      },
      md: {
        start: "md:items-start md:text-left",
        center: "md:items-center md:text-center",
      },
    },
    defaultVariants: {
      base: "start",
      xs: "start",
      md: "start",
    },
  },
)

export function ContentWrapper({ children, layout, className }) {
  return (
    <div
      className={cn(
        contentWrapperVariants({
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

export const asideVariants = cva("grid", {
  variants: {
    base: {
      top: "row-start-1 col-span-24",
      bottom: "row-start-2 col-span-24",
    },
    md: {
      start: "md:row-start-1 col-span-24 md:col-[1_/_span_12] md:pr-6 lg:pr-8",
      end: "md:row-start-1 col-span-24 md:col-[13_/_span_12] md:pl-6 lg:pl-8",
      top: "row-start-1 col-span-24",
      bottom: "row-start-2 col-span-24",
    },
  },
  defaultVariants: {
    base: "top",
    md: "end",
  },
})

export function Aside({ children, layout, className }) {
  return (
    <div
      className={cn(
        asideVariants({
          base: layout?.base,
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
  const Comp = as || "h1"
  return (
    <Comp
      className={cn(
        "font-display font-semibold text-3xl md:text-4xl lg:text-5xl xl:text-6xl max-w-5xl",
        className,
      )}
    >
      {children}
    </Comp>
  )
}

export function Description({ children, className }) {
  return (
    <p className={cn("text-lg lg:text-xl max-w-2xl", className)}>{children}</p>
  )
}
