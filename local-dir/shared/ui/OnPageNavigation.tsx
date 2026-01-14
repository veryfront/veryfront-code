import { Heading } from "@/shared/ui/Heading"
import { usePageContext } from "@/lib/usePageContext"
import { cn } from "@/shared/utils/utils"

export function OnPageNavigation({ title = "On this page", onClick }) {
  const pageContext = usePageContext()
  const mdxHeadings = pageContext.mdxHeadings ?? []

  return (
    <nav>
      {mdxHeadings?.length > 0 && (
        <>
          <p className="mb-4 text-sm font-medium">{title}</p>
          <ul className="text-sm space-y-3 pl-3.5 border-l">
            {mdxHeadings?.map((anchor) => (
              <li key={anchor.id} className={cn(anchor.level > 3 && "pl-3")}>
                <a
                  className="text-foreground hover:text-primary focus:text-primary leading-snug"
                  href={`#${anchor.id}`}
                  onClick={() => onClick?.(anchor)}
                >
                  {anchor.text}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  )
}
