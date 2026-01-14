import { cn } from "@/shared/utils/utils"
import { Slot } from "https://esm.sh/@radix-ui/react-slot@1.0.1"
import React from "react"

type CardProps = React.HTMLAttributes<HTMLElement>

export const Card = React.forwardRef<HTMLElement, CardProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <article
        ref={ref}
        className={cn(
          "border overflow-hidden border-border/60 bg-card rounded-lg relative shadow-sm",
          className,
        )}
        {...props}
      >
        {children}
      </article>
    )
  },
)

Card.displayName = "Card"

type CardFooterProps = React.HTMLAttributes<HTMLDivElement>

export function CardFooter({ children, className, ...props }: CardFooterProps) {
  return (
    <div
      className={cn("flex p-3 items-center gap-0 justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

type CardFooterContentProps = React.HTMLAttributes<HTMLDivElement>

export function CardFooterContent({
  children,
  className,
  ...props
}: CardFooterContentProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)} {...props}>
      {children}
    </div>
  )
}

interface CardTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
  as?: string
}

export function CardTitle({
  children,
  className,
  asChild,
  as,
  ...props
}: CardTitleProps) {
  const Comp = asChild ? Slot : as || "p"

  return (
    <Comp
      className={cn("text-card-foreground text-sm font-medium", className)}
      {...props}
    >
      {children}
    </Comp>
  )
}

interface CardDescriptionProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
  as?: string
}

export function CardDescription({
  children,
  className,
  asChild,
  as,
  ...props
}: CardDescriptionProps) {
  const Comp = asChild ? Slot : as || "p"

  return (
    <Comp className={cn("text-sm", className)} {...props}>
      {children}
    </Comp>
  )
}

type CardLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>

export function CardLink({ children, className, ...props }: CardLinkProps) {
  return (
    <a
      className={cn(
        'before:content-[""] before:inset-0 before:absolute cursor:inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-lg',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  )
}
