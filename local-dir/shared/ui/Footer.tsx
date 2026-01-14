import { Container } from "@/shared/ui/Container"
import { Heading } from "@/shared/ui/Heading"
import { cn, cva } from "@/shared/utils/utils"
import { FacebookIcon } from "@/shared/ui/icons/FacebookIcon"
import { GithubIcon } from "@/shared/ui/icons/GithubIcon"
import { InstagramIcon } from "@/shared/ui/icons/InstagramIcon"
import { LinkedInIcon } from "@/shared/ui/icons/LinkedInIcon"
import { TwitterIcon } from "@/shared/ui/icons/TwitterIcon"
import { IconButton } from "@/shared/ui/IconButton"
import { ColorModeToggle } from "@/shared/ui/ColorModeToggle"
import { Logo } from "@/shared/ui/Logo"

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
        "grid grid-cols-1 sm:grid-cols-[0.75fr_0.25fr] pb-10 lg:pb-12 xl:pb-14 gap-6 md:gap-8 lg:gap-10 xl:gap-0 items-start",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function UpperNav({ children, className }) {
  return (
    <div className={cn("flex sm:col-start-1 sm:row-start-1", className)}>
      {children}
    </div>
  )
}

export function Lower({ children, className }) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:items-center justify-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function NavSections({ children, className }) {
  return (
    <section
      className={cn(
        "grid gap-6 sm:gap-8 md:gap-10 grid-cols-1 xs:grid-cols-3 md:col-start-1",
        className,
      )}
    >
      {children}
    </section>
  )
}

export function NavSection({ children, className }) {
  return (
    <article
      className={cn("flex flex-col gap-2 sm:gap-3 sm:pr-3 md:pr-6", className)}
    >
      {children}
    </article>
  )
}

export function SectionHeading({ children, className }) {
  return (
    <Heading as="h3" level="4" className={cn("mb-1", className)}>
      {children}
    </Heading>
  )
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
        "underline-offset-8 hover:underline  text-sm focus:underline focus:outline-none decoration-1",
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
        "hover:underline focus:underline underline-offset-4",
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

export function Footer() {
  return (
    <Root divided={true}>
      <Container>
        <Upper>
          <div className="sm:ml-auto">
            <ColorModeToggle />
          </div>

          <UpperNav>
            <NavSections>
              <NavSection>
                <SectionHeading>Product</SectionHeading>

                <NavLinks>
                  <NavLink href="/studio">Studio</NavLink>
                  <NavLink href="/templates">Templates</NavLink>
                  <NavLink href="/libraries">Libraries</NavLink>
                  <NavLink href="/figma-kit">Figma Kit</NavLink>
                  <NavLink href="/pricing">Pricing</NavLink>
                </NavLinks>
              </NavSection>

              <NavSection>
                <SectionHeading>Resources</SectionHeading>

                <NavLinks>
                  <NavLink href="/docs">Docs</NavLink>
                  <NavLink href="/faq">FAQ</NavLink>
                  <NavLink href="/contact/support">Support</NavLink>
                </NavLinks>
              </NavSection>

              <NavSection>
                <SectionHeading>Legal</SectionHeading>

                <NavLinks>
                  <NavLink href="/privacy">Privacy Policy</NavLink>
                  <NavLink href="/terms">Terms of Service</NavLink>
                  <NavLink href="/imprint">Imprint</NavLink>
                </NavLinks>
              </NavSection>
            </NavSections>
          </UpperNav>
        </Upper>

        <Lower>
          <SocialIcons>
            <IconButton asChild aria-label="GitHub">
              <a href="https://github.com/veryfront">
                <GithubIcon />
              </a>
            </IconButton>

            <IconButton asChild aria-label="LinkedIn">
              <a href="https://www.linkedin.com/company/veryfront">
                <LinkedInIcon />
              </a>
            </IconButton>

            <IconButton asChild aria-label="X">
              <a href="https://x.com/veryfront">
                <TwitterIcon />
              </a>
            </IconButton>

            <IconButton asChild aria-label="Facebook">
              <a href="https://www.facebook.com/veryfront">
                <FacebookIcon />
              </a>
            </IconButton>

            <IconButton asChild aria-label="Instagram">
              <a href="https://www.instagram.com/veryfront">
                <InstagramIcon />
              </a>
            </IconButton>
          </SocialIcons>

          <Copyright>
            {`© ${new Date().getFullYear()} Veryfront. All rights reserved.`}
          </Copyright>
        </Lower>
      </Container>
    </Root>
  )
}
