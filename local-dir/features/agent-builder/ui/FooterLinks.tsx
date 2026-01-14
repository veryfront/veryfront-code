/**
 * @fileoverview Footer navigation links component.
 */

const FOOTER_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/imprint", label: "Imprint" },
] as const

/**
 * Footer navigation links.
 */
export function FooterLinks() {
  return (
    <footer className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-6 z-10">
      {FOOTER_LINKS.map(({ href, label }) => (
        <a
          key={label}
          href={href}
          className="text-gray-500 no-underline text-sm hover:text-gray-700 transition-colors"
        >
          {label}
        </a>
      ))}
    </footer>
  )
}
