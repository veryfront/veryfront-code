import { Card, CardTitle, CardDescription, CardLink } from "@/shared/ui/Card"

export function LibraryCard({ library, ...props }) {
  const href = `/libraries/${library.id}`

  return (
    <Card
      className="hover:border-primary hover:shadow-md transition-[box-shadow,transform] duration-200 cursor-pointer flex flex-col"
      {...props}
    >
      <div className="p-4 flex flex-col gap-0.5">
        <CardTitle className="lg:text-base flex flex-col gap-3 mb-4">
          <library.icon className="size-8" />

          <CardLink
            href={href}
            className="before:block before:absolute before:inset-0 before:cursor-pointer text-base"
          >
            {library.title}
          </CardLink>
        </CardTitle>

        <CardDescription className="md:text-sm">
          {library.description}
        </CardDescription>
      </div>
      <div className="p-4 w-full flex flex-col gap-6 items-start mt-auto">
        <span className="font-medium text-[0.65rem] bg-muted/10 inline-flex rounded-full px-2 py-0.5 text-muted">
          {library.category}
        </span>
      </div>
    </Card>
  )
}
