import { IFramePreview } from "@/shared/ui/IFramePreview"
import { Card, CardTitle, CardDescription, CardLink } from "@/shared/ui/Card"

function getChildStyles(viewport, padding = 15) {
  const styles = {
    "scrollbar-width": "none",
  }

  if (!viewport) {
    return styles
  }

  const viewportWidth = viewport?.width
  const viewportHeight = viewport?.height
  const viewportMaxWidth = viewport?.maxWidth
  const viewportPaddingX = viewport?.paddingX
  const viewportPaddingY = viewport?.paddingY

  if (viewportPaddingX) {
    styles["padding-left"] = `${padding}px`
    styles["padding-right"] = `${padding}px`
  }

  if (viewportMaxWidth || viewportWidth) {
    styles["max-width"] = `${viewportMaxWidth || viewportWidth}px`
    styles["box-sizing"] = "content-box"
    styles["margin-left"] = "auto"
    styles["margin-right"] = "auto"
  }

  if (viewportHeight) {
    styles["min-height"] = `${viewportHeight}px`
  }

  if (viewportPaddingY) {
    styles["padding-top"] = `${padding}px`
    styles["padding-bottom"] = `${padding}px`
  }

  return styles
}

export function countComponents(components = []) {
  let totalCount = 0

  components.forEach((component) => {
    if (component.variants?.length > 0) {
      totalCount += component.variants.length
    } else {
      totalCount++
    }
  })

  return totalCount
}

export function ComponentsSectionCard({
  colorMode,
  library,
  useCase,
  category,
  section,
  ...props
}) {
  const previewComponent =
    section.components?.find(
      (component) => component.frontmatter?.metadata?.isSectionPreview,
    ) ?? section.components?.[0]
  const count = countComponents(section.components)
  const iframeSrc = `https://${previewComponent.librarySlug}.veryfront.com${previewComponent.importPath}`
  const viewport = previewComponent.frontmatter?.metadata?.viewport
  const paddingWhenCentered = 15
  const viewportWidth = viewport?.width
    ? viewport?.width + 2 * paddingWhenCentered
    : null

  const href = [
    "/libraries",
    library?.id || "all",
    useCase?.id || "all",
    category?.name || "all",
    section?.name || "all",
  ].join("/")

  const isNotSection =
    previewComponent.frontmatter?.metadata?.sectionName ===
    previewComponent.frontmatter?.metadata?.componentName

  return (
    <Card
      className="hover:border-primary hover:shadow-md transition-[box-shadow,transform] duration-200 cursor-pointer"
      {...props}
    >
      <div className="overflow-hidden bg-card px-4 pt-4 w-full">
        <IFramePreview
          key={iframeSrc}
          src={iframeSrc}
          viewport={viewportWidth}
          scaleX
          scaleY
          preventInteraction
          containerClassName="aspect-video overflow-hidden rounded-t-sm flex items-center justify-center"
          childStyles={getChildStyles(viewport, paddingWhenCentered)}
          colorMode={colorMode}
        />
      </div>

      <div className="p-4 flex flex-col gap-0.5">
        <CardTitle className="lg:text-base">
          <CardLink
            href={href}
            className="before:block before:absolute before:inset-0 before:cursor-pointer"
          >
            {section.name}
          </CardLink>
        </CardTitle>

        <CardDescription className="md:text-sm">
          {count}{" "}
          {count > 1
            ? isNotSection
              ? "variants"
              : "components"
            : isNotSection
              ? "variant"
              : "component"}
        </CardDescription>
      </div>
    </Card>
  )
}
