import { slugify, cn } from "@/shared/utils/utils"

export function H3({ children, as = "h3", id, className, ...props }) {
  const Comp = as || "h3"

  return (
    <Comp
      className={cn("scroll-m-20 font-medium", className)}
      id={id || (typeof children === "string" ? slugify(children) : "")}
      {...props}
    >
      {children}
    </Comp>
  )
}
