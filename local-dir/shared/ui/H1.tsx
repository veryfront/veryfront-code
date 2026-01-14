import { slugify, cn } from "@/shared/utils/utils"

export function H1({ children, as = "h1", id, className, ...props }) {
  const Comp = as || "h1"

  return (
    <Comp
      className={cn(
        "scroll-m-20 text-3xl md:text-4xl lg:text-5xl leading-[1.1] md:leading-[1.1] lg:leading-[1.1] font-medium font-display",
        className,
      )}
      id={id || (typeof children === "string" ? slugify(children) : "")}
      {...props}
    >
      {children}
    </Comp>
  )
}
