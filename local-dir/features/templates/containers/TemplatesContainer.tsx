import { TemplatesList } from "@/features/templates/ui/TemplatesList"
import { useTheme } from "https://esm.sh/next-themes"
import React from "react"
import { useQuery } from "@tanstack/react-query"
import debounce from "https://esm.sh/lodash.debounce"

function onPreview(previewUrl: string) {
  if (previewUrl) {
    window.open(previewUrl, "_blank", "noopener,noreferrer")
  }
}

interface TemplatesContainerProps {
  category?: string
  limit?: number
  sort?: string
  FiltersComponent?: React.ComponentType<{
    searchTerm?: string
    onSearch?: (value: string) => void
    category?: string
    onCategory: (value: string) => void
  }>
}

export function TemplatesContainer({
  useCase = "all",
  limit,
  sort,
  FiltersComponent,
}: TemplatesContainerProps) {
  const { resolvedTheme } = useTheme()
  const [isForkingId, setIsForkingId] = React.useState<string | undefined>(
    undefined,
  )

  const [searchTerm, setSearchTerm] = React.useState("")
  const [category, setCategory] = React.useState(useCase)

  const onSearch = debounce((value: string) => {
    setSearchTerm(value)
  }, 150)

  function onCategory(category: string) {
    setCategory(category)
  }

  function onFork(template) {
    if (!template) return

    setIsForkingId(template.id)
    window.location.href = `https://new.veryfront.com?template=${template.slug}&prompt=forked`
  }

  const query = useQuery({
    queryKey: ["templates", limit, searchTerm, category],
    queryFn: async () => {
      // Build query parameters
      const params = new URLSearchParams()
      params.set("excludeBlank", "true")

      if (sort) {
        params.set("sort", sort)
      }
      if (limit) {
        params.set("limit", limit)
      }
      if (searchTerm) {
        params.set("search", searchTerm)
      }
      if (category && category !== "all") {
        params.set("useCase", category)
      }

      const queryString = params.toString()
      const url = `/api/templates${queryString ? `?${queryString}` : ""}`

      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
        },
      })

      const data = await response.json()
      return data
    },
    placeholderData: (previousData) => previousData,
  })

  return (
    <>
      {FiltersComponent && (
        <FiltersComponent
          searchTerm={searchTerm}
          onSearch={onSearch}
          category={category}
          onCategory={onCategory}
        />
      )}
      <TemplatesList
        templates={query.data || []}
        isLoading={query.isLoading}
        isEmpty={query.isFetched && query.data?.length === 0}
        onPreview={onPreview}
        colorMode={resolvedTheme}
        onFork={onFork}
        isForkingId={isForkingId}
        onSearch={onSearch}
        onCategory={onCategory}
      />
    </>
  )
}
