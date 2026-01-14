import { useComponents } from "@/features/components/hooks/useComponents"
import {
  librariesConfig,
  useCasesConfig,
} from "@/shared/utils/componentsConfig"
import { ComponentsSection } from "@/features/components/ui/ComponentsSection"
import { useTheme } from "https://esm.sh/next-themes"

const SORT_ORDER = ["Sections", "Modules", "Elements"]

export function ComponentsSectionContainer({
  libraryId,
  useCaseId,
  categoryId,
  searchTerm,
  limit,
  categoryLimit,
  sectionLimit,
  showBreadcrumb,
}) {
  const query = useComponents({
    library: libraryId,
    useCase: useCaseId,
    category: categoryId,
    searchTerm,
    limit,
  })

  const categories =
    query.categories
      ?.sort((a, b) => {
        const indexA = SORT_ORDER.indexOf(a.name)
        const indexB = SORT_ORDER.indexOf(b.name)
        return indexA - indexB
      })
      ?.slice(0, categoryLimit || undefined)
      ?.map((category) => ({
        ...category,
        sections: category.sections?.slice(0, sectionLimit || undefined),
      })) ?? []

  const { resolvedTheme } = useTheme()

  return (
    <ComponentsSection
      library={librariesConfig.find((library) => library.id === libraryId)}
      useCase={useCasesConfig.find((useCase) => useCase.id === useCaseId)}
      categories={categories}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      isEmpty={query.isFetched && categories.length === 0}
      colorMode={resolvedTheme}
      showBreadcrumb={showBreadcrumb}
    />
  )
}
