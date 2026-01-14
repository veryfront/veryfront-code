import { Container } from "@/shared/ui/Container"
import { CardSkeleton } from "@/shared/ui/CardSkeleton"
import { TemplateCard } from "@/features/templates/ui/TemplateCard"

export function TemplatesList({
  templates = [],
  onFork,
  onPreview,
  isForkingId,
  colorMode,
  onSearch,
  category,
  onCategory,
  isLoading,
  isEmpty,
}) {
  if (isEmpty) {
    return (
      <Container>
        <div className="py-12 text-center text-muted">
          <p>No templates found</p>
        </div>
      </Container>
    )
  }

  if (!Array.isArray(templates)) {
    return null
  }

  return (
    <Container>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            {templates?.map((template) => (
              <TemplateCard
                key={template.id}
                project={template}
                onPreview={onPreview}
                colorMode={colorMode}
                onFork={onFork}
                isForkLoading={isForkingId === template.id}
              />
            ))}
          </>
        )}
      </div>
    </Container>
  )
}
