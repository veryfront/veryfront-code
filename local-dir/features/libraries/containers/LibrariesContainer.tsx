import { LibrariesList } from "@/features/libraries/ui/LibrariesList"
import React from "react"
import { useQuery } from "@tanstack/react-query"
import debounce from "https://esm.sh/lodash.debounce"
import { librariesConfig } from "@/shared/utils/componentsConfig"

interface TemplatesContainerProps {
  initialCategory?: string
  limit?: number
  FiltersComponent?: React.ComponentType<{
    searchTerm?: string
    category?: string
    onCategory: (value: string) => void
  }>
}

export function LibrariesContainer({
  initialCategory,
  limit,
  FiltersComponent,
}: TemplatesContainerProps) {
  const [searchTerm, setSearchTerm] = React.useState("")
  const [category, setCategory] = React.useState(initialCategory)

  const onSearch = debounce((value: string) => {
    setSearchTerm(value)
  }, 150)

  function onCategory(category: string) {
    setCategory(category)
  }

  const query = useQuery({
    queryKey: ["libraries", limit, searchTerm, category],
    queryFn: async () => {
      const data = librariesConfig
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
      <LibrariesList
        libraries={query.data || []}
        isLoading={query.isLoading}
        isEmpty={query.isFetched && query.data?.length === 0}
        onSearch={onSearch}
        onCategory={onCategory}
      />
    </>
  )
}
