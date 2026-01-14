import { Heading } from "@/shared/ui/Heading"
import { cn, cva } from "@/shared/utils/utils"
import { useRouter } from "@/lib/Router"

export const menuLinkVariants = cva(
  "text-foreground/70 hover:text-foreground focus:text-foreground underline-offset-8 hover:underline focus:underline focus:outline-none text-sm inline-flex gap-3 items-center text-foreground/50",
  {
    variants: {
      variant: {
        default: "",
        active: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export function MenuLink({ href, children, variant = "default", onClick }) {
  const className = cn(menuLinkVariants({ variant }))

  return (
    <a className={className} href={href} onClick={() => onClick?.(children)}>
      {children}
    </a>
  )
}

export function SidebarNavigation({ sections, onClick }) {
  const router = useRouter()
  const cleanPath = router.path?.replace(/\+/g, " ")

  return (
    <nav className="grid gap-8 xs:grid-cols-3 md:grid-cols-4 lg:grid-cols-1">
      {sections?.map((section) => (
        <ul key={section.title}>
          <li>
            {section.title && (
              <p className="mb-4 text-sm font-medium">{section.title}</p>
            )}
            <ul className="space-y-3">
              {section.pages?.map((page) => (
                <li key={page.href}>
                  <MenuLink
                    href={page.href}
                    variant={
                      cleanPath === page.href || page.isActive
                        ? "active"
                        : "default"
                    }
                    onClick={onClick}
                  >
                    {page.icon && page.icon}
                    {page.title}
                  </MenuLink>
                </li>
              ))}
            </ul>
          </li>
        </ul>
      ))}
    </nav>
  )
}
