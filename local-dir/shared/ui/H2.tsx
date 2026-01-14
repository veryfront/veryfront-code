import { slugify, cn } from "@/shared/utils/utils"

export function H2({ children, as = "h2", id, className, ...props }) {
  const Comp = as || "h2"

  return (
    <Comp
      className={cn("scroll-m-20 text-lg md:text-xl font-medium", className)}
      id={id || (typeof children === "string" ? slugify(children) : "")}
      {...props}
    >
      {children}
    </Comp>
  )
}
