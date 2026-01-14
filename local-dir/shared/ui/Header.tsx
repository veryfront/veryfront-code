import { Button } from "@/shared/ui/Button"
import { Container } from "@/shared/ui/Container"
import { Logo } from "@/shared/ui/Logo"
import { useUserContext } from "@/shared/context/UserProvider"
import { cn, cva } from "@/shared/utils/utils"
import { useRouter } from "@/lib/Router"
import {
  BreakpointProvider,
  useBreakpoints,
} from "@/shared/context/BreakpointProvider"
import * as DialogPrimitive from "https://esm.sh/@radix-ui/react-dialog@1.0.3?external=react,react-dom"
import { XIcon, MenuIcon } from "https://esm.sh/lucide-react"
import { IconButton } from "@/shared/ui/IconButton"
import React from "react"
import { usePageContext } from "@/lib/usePageContext"

export const rootVariants = cva(
  "flex items-center h-14 md:h-16 relative z-40",
  {
    variants: {
      divided: {
        true: "border-b border-b-divider",
      },
    },
    defaultVariants: {
      divided: "",
    },
  },
)

export function Root({ children, divided, className }) {
  return (
    <BreakpointProvider>
      <header className={cn(rootVariants({ divided, className }))}>
        {children}
      </header>
    </BreakpointProvider>
  )
}

export function Wrapper({ children, className }) {
  return (
    <Container className={cn("flex items-center", className)}>
      {children}
    </Container>
  )
}

export const logoWrapperVariants = cva("relative z-50 min-w-0 shrink-0", {
  variants: {
    variant: {
      left: "pr-6 md:pr-8 lg:pr-16",
      centered: "pr-6 md:pr-8 md:pr-0 md:flex-1",
    },
  },
  defaultVariants: {
    variant: "left",
  },
})

export function LogoWrapper({ children, className, variant }) {
  return (
    <div className={cn(logoWrapperVariants({ variant, className }))}>
      {children}
    </div>
  )
}

export function MenuWrapper({ children, className }) {
  return (
    <div className={cn("flex items-center gap-4 flex-1", className)}>
      {children}
    </div>
  )
}

export const actionsWrapperVariants = cva(
  "flex items-center gap-1 md:gap-2 lg:gap-3",
  {
    variants: {
      variant: {
        left: "",
        centered: "md:flex-1 justify-end",
      },
    },
    defaultVariants: {
      variant: "left",
    },
  },
)

export function ActionsWrapper({ children, variant, className }) {
  return (
    <div className={cn(actionsWrapperVariants({ variant, className }))}>
      {children}
    </div>
  )
}

export function NavLink({ children, href, className, ...props }) {
  return (
    <a
      className={cn(
        "underline-offset-8 hover:underline focus:underline focus:outline-none decoration-2",
        className,
      )}
      href={href}
    >
      {children}
    </a>
  )
}

export function HorizontalNav({ children, className }) {
  return (
    <nav className={cn("flex items-center gap-6 lg:gap-10", className)}>
      {children}
    </nav>
  )
}

export function VerticalNav({ children, className }) {
  return (
    <nav className={cn("flex flex-col items-stretch gap-3", className)}>
      {children}
    </nav>
  )
}

export function HideOnMobile({ className, children }) {
  const breakpoints = useBreakpoints()

  return (
    <div
      className={cn("max-md:hidden", className)}
      aria-hidden={!breakpoints.isAboveTablet}
    >
      {children}
    </div>
  )
}

export function HideOnDesktop({ className, children }) {
  const breakpoints = useBreakpoints()

  return (
    <div
      className={cn("md:hidden", className)}
      aria-hidden={breakpoints.isAboveTablet}
    >
      {children}
    </div>
  )
}

export function MobileMenu({ children }) {
  const [open, setOpen] = React.useState(false)
  const breakpoints = useBreakpoints()
  const router = useRouter()

  React.useEffect(() => {
    if (breakpoints.isAboveTablet) {
      setOpen(false)
    }
  }, [breakpoints.isAboveTablet, setOpen])

  React.useEffect(() => {
    if (router.pathname) {
      setOpen(false)
    }
  }, [router.pathname, setOpen])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <IconButton aria-label="Open Menu" className="-mr-2">
          <MenuIcon width={20} height={20} />
        </IconButton>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-black/80 fixed inset-0 top-12 md:top-14 lg:top-16 z-30" />
      </DialogPrimitive.Portal>
      <DialogPrimitive.Content className="bg-popover text-popover-foreground outline-none pb-4 absolute top-0 pt-14 md:pt-16 lg:pt-[4.5rem] inset-x-0 w-full z-30">
        <DialogPrimitive.Close asChild>
          <IconButton
            aria-label="Close Menu"
            className="absolute right-3 top-3 z-50"
          >
            <XIcon width={20} height={20} />
          </IconButton>
        </DialogPrimitive.Close>
        <Container className="max-w-full">{children}</Container>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  )
}

export const headerMenuItems = [
  {
    label: "Docs",
    href: "/docs",
  },
  {
    label: "Studio",
    href: "/studio",
  },
  {
    label: "Templates",
    href: "/templates",
  },
  {
    label: "Libraries",
    href: "/libraries",
  },
  {
    label: "Figma Kit",
    href: "/figma-kit",
  },
  {
    label: "Pricing",
    href: "/pricing",
  },
]

export const headerActions = [
  {
    href: "/sign-in",
    label: "Sign in",
    variant: "primary",
  },
]

export const headerActionsLoggedIn = [
  {
    href: "/dashboard",
    label: "Dashboard",
    variant: "primary",
  },
]

export function Header() {
  const user = useUserContext()
  const actions = user ? headerActionsLoggedIn : headerActions
  const context = usePageContext()

  return (
    <Root divided={context.frontmatter?.dividedHeader ?? true}>
      <Container className="flex items-center">
        <LogoWrapper variant="centered">
          <Logo href="/" />
        </LogoWrapper>

        <MenuWrapper>
          <HideOnMobile>
            <HorizontalNav className="text-sm font-medium">
              {headerMenuItems?.map(({ href, label }) => (
                <NavLink
                  key={label}
                  href={href}
                  className="decoration-1 whitespace-nowrap"
                >
                  {label}
                </NavLink>
              ))}
            </HorizontalNav>
          </HideOnMobile>
        </MenuWrapper>

        <ActionsWrapper variant="centered">
          <HideOnDesktop>
            <MobileMenu>
              <VerticalNav>
                {headerMenuItems?.map(({ href, label }) => (
                  <NavLink key={href} href={href} className="decoration-1">
                    {label}
                  </NavLink>
                ))}
              </VerticalNav>

              <div
                className={cn(
                  "grid gap-2 mt-6",
                  actions.length > 1 && "grid-cols-2",
                )}
              >
                {actions?.map(({ href, label, variant }) => (
                  <Button asChild key={href} variant={variant}>
                    <a href={href}>{label}</a>
                  </Button>
                ))}
              </div>
            </MobileMenu>
          </HideOnDesktop>

          <HideOnMobile>
            <div className="flex items-center gap-2 lg:gap-3">
              {actions?.map(({ href, label, variant }) => (
                <Button
                  asChild
                  key={label}
                  variant={context.frontmatter?.slimCta ? "link" : variant}
                  size="md"
                >
                  <a href={href}>{label}</a>
                </Button>
              ))}
            </div>
          </HideOnMobile>
        </ActionsWrapper>
      </Container>
    </Root>
  )
}
