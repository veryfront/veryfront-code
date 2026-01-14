import { Button } from "@components/Button"
import { Container } from "@components/Container"
import { Logo } from "@components/Logo"
import { useUserContext } from "@components/providers/UserProvider"
import { cn, cva } from "@components/utils"
import { useRouter } from "https://core.veryfront.com/@components/index"
import {
  BreakpointProvider,
  useBreakpoints,
} from "https://core.veryfront.com/@components/providers/BreakpointProvider"
import * as DialogPrimitive from "https://esm.veryfront.com/@radix-ui/react-dialog@1.0.3?external=react,react-dom"
import {
  MenuIcon,
  XIcon,
} from "https://veryfront-ui.veryfront.com/@components/Icons"
import { IconButton } from "https://veryfront-ui.veryfront.com/@components/elements/IconButton"
import React from "react"
 
export const rootVariants = cva(
  "flex items-center h-16 md:h-[4.5rem] lg:h-[5rem] relative z-20",
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
      centered: "pr-6 md:pr-8 lg:pr-0 lg:flex-1",
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
        centered: "lg:flex-1 justify-end",
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
        <DialogPrimitive.Overlay className="bg-black/80 fixed inset-0 top-16 z-10" />
      </DialogPrimitive.Portal>
      <DialogPrimitive.Content className="bg-popover text-popover-foreground outline-none pb-4 absolute top-0 pt-20 inset-x-0 w-full z-20">
        <DialogPrimitive.Close asChild>
          <IconButton
            aria-label="Close Menu"
            className="absolute right-3 top-3 z-30"
          >
            <XIcon width={20} height={20} />
          </IconButton>
        </DialogPrimitive.Close>
        <Container className="max-w-full">{children}</Container>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  )
}

export const headerMenuItems = []

export const headerActions = [
  {
    href: "/sign-in",
    label: "Sign in",
    variant: "primary",
  }
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
  const actions = user ? headerActions : headerActions

  return (
    <Root>
      <Container className="flex items-center">
        <LogoWrapper variant="centered">
          <Logo href="/" />
        </LogoWrapper>

        <MenuWrapper>
          <HideOnMobile>
            <HorizontalNav className="max-lg:text-sm">
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
          <div className="flex items-center gap-2 lg:gap-3">
            {actions?.map(({ href, label, variant }) => (
              <Button asChild key={label} variant={variant} size="sm">
                <a href={href}>{label}</a>
              </Button>
            ))}
          </div>
        </ActionsWrapper>
      </Container>
    </Root>
  )
}
