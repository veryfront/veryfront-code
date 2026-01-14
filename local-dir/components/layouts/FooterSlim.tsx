import { Container } from "@components/Container"
import { H3 } from "@components/typography/H3"
import { cn, cva } from "@components/utils"
import {
  FacebookIcon,
  GithubIcon,
  InstagramIcon,
  LinkedInIcon,
  TwitterIcon,
} from "https://veryfront-ui.veryfront.com/@components/Icons"
import { IconButton } from "https://veryfront-ui.veryfront.com/@components/elements/IconButton"

export const rootVariants = cva("py-8 md:py-10 lg:py-14 xl:py-18", {
  variants: {
    divided: {
      true: "border-t border-t-divider",
    },
  },
  defaultVariants: {
    divided: "",
  },
})
 
export function Root({ children, divided, className }) {
  return (
    <footer className={cn(rootVariants({ divided, className }))}>
      {children}
    </footer>
  )
}

export function Wrapper({ children, className }) {
  return <Container className={className}>{children}</Container>
}

export function Upper({ children, className }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 lg:grid-cols-[0.75fr_0.25fr] pb-10 lg:pb-12 xl:pb-14 gap-6 md:gap-8 lg:gap-10 xl:gap-0 items-start",
        className,
      )}
      adfasf={undefined}
    >
      {children}
    </div>
  )
}

export function UpperNav({ children, className }) {
  return (
    <div className={cn("pt-0.5 flex lg:col-start-1 lg:row-start-1", className)}>
      {children}
    </div>
  )
}

export function Lower({ children, className }) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row md:items-center justify-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function NavSections({ children, className }) {
  return (
    <div
      className={cn(
        "grid gap-6 sm:gap-8 md:gap-12 lg:gap-20 grid-cols-1 sm:grid-cols-4 md:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function NavSection({ children, className }) {
  return (
    <div
      className={cn("flex flex-col gap-3 md:gap-4 items-stretch", className)}
    >
      {children}
    </div>
  )
}

export function SectionHeading({ children, className }) {
  return <H3 className={cn("mb-1", className)}>{children}</H3>
}

export function NavLinks({ children, className }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 md:gap-2.5 lg:gap-3 items-stretch",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function NavLink({ children, href, className, ...props }) {
  return (
    <a
      href={href}
      className={cn(
        "underline-offset-8 hover:underline focus:underline focus:outline-none decoration-1",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  )
}

export function LegalLinks({ children, className }) {
  return (
    <div className={cn("flex gap-3 md:gap-4 lg:gap-5 items-center", className)}>
      {children}
    </div>
  )
}

export function LegalLink({ children, href, className, ...props }) {
  return (
    <a
      href={href}
      className={cn(
        "text-sm hover:underline focus:underline underline-offset-4",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  )
}

export function SocialIcons({ children, className }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>{children}</div>
  )
}

export function Copyright({ children, className }) {
  return <p className={cn("text-sm", className)}>{children}</p>
}

<Root className="py-4 md:py-6 lg:py-6 xl:py-6">
  <Container>
    <Lower>
      <div className="flex flex-col gap-3 items-center sm:flex-row justify-between w-full opacity-60">
        <nav className="flex flex-row gap-5 sm:gap-6 md:gap-7">
          <NavLink className="text-xs sm:text-sm" href="/templates">Templates</NavLink>
          <NavLink className="text-xs sm:text-sm" href="/components">Components</NavLink>
          <NavLink className="text-xs sm:text-sm" href="/figma-kit">Figma Kit</NavLink>
          <NavLink className="text-xs sm:text-sm" href="/pricing">Pricing</NavLink>
        </nav>
        <nav className="flex flex-row gap-5 sm:gap-6 md:gap-7">
          <NavLink className="text-xs sm:text-sm" href="/privacy">Privacy</NavLink>
          <NavLink className="text-xs sm:text-sm" href="/terms">Terms</NavLink>
          <NavLink className="text-xs sm:text-sm" href="/imprint">Imprint</NavLink>
        </nav>
      </div>
    </Lower>
  </Container>
</Root>
