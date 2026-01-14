import { Card, CardTitle, CardDescription, CardLink } from "@/shared/ui/Card"
import { CircleChevronRight } from "https://esm.sh/lucide-react"

export function DocsCard({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  return (
    <Card className="not-prose group hover:border-border/90 group">
      <div className="p-4 pr-12 flex flex-col gap-3">
        <CardTitle className="text-lg md:text-xl">
          <CardLink href={href}>{title}</CardLink>
        </CardTitle>

        <CardDescription className="md:text-sm text-foreground">
          {description}
        </CardDescription>

        <span className="text-card-foreground absolute bottom-3.5 right-3.5 opacity-50 group-hover:opacity-80">
          <CircleChevronRight className="size-4" />
        </span>
      </div>
    </Card>
  )
}
