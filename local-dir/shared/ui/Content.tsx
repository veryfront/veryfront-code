import { Container } from "@/shared/ui/Container"
import * as Section from "@/shared/ui/Section"
import { cn, cva } from "@/shared/utils/utils"

export function Root({ children, className }) {
  return (
    <Section.Root className={cn("py-8 md:py-14 lg:py-16 xl:py-20", className)}>
      {children}
    </Section.Root>
  )
}

export function Wrapper({ children, className }) {
  return (
    <Container
      className={cn(
        "px-0 md:px-6 grid grid-cols-[1fr] md:grid-cols-[repeat(24,1fr)] gap-y-6 md:gap-x-2",
        className,
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
      start: "md:row-start-1 md:col-[1_/_span_8]",
      end: "md:row-start-1 md:col-[16_/_span_8]",
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
  "flex flex-1 flex-col gap-4 lg:gap-5",
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
      start: "md:row-start-1 col-span-24 md:col-[1_/_span_13]",
      end: "md:row-start-1 col-span-24 md:col-[12_/_span_13]",
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

export function Actions({ children, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-stretch xs:flex-row xs:items-center gap-3 lg:pt-2",
        className,
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
        "font-display font-medium text-2xl md:text-3xl lg:text-4xl max-w-5xl",
        className,
      )}
    >
      {children}
    </Comp>
  )
}

export function Description({ children, className }) {
  return <p className={cn("lg:text-lg max-w-xl", className)}>{children}</p>
}
