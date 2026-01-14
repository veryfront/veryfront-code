import { ChevronRight } from "https://esm.sh/lucide-react"

export function Breadcrumb({ children }) {
  return (
    <nav aria-label="Breadcrumb" className="max-lg:pb-6 max-w-full text-sm">
      <ol className="overflow-hidden text-ellipsis">{children}</ol>
    </nav>
  )
}

export function BreadcrumbItem({ children, isCurrent }) {
  return (
    <li className="inline-flex items-center capitalize">
      {isCurrent ? (
        <span className="whitespace-nowrap text-muted">{children}</span>
      ) : (
        children
      )}
      {!isCurrent && <ChevronRight className="text-muted size-3.5 mx-1" />}
    </li>
  )
}

export function BreadcrumbLink({ children, href, onClick, ...props }) {
  return (
    <a
      href={href}
      className="hover:underline underline-offset-4"
      onClick={onClick}
      {...props}
    >
      {children}
    </a>
  )
}
