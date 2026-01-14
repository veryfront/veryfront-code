import React from "react"
import debounce from "https://esm.sh/lodash.debounce"

type RenderProps = {
  searchTerm: string
  onSearch: (value: string) => void
  library: string
  onLibraryChange: (value: string) => void
  useCase: string
  onUseCaseChange: (value: string) => void
  category: string
  onCategoryChange: (value: string) => void
}

interface ComponentsFiltersContainerProps {
  children: (props) => React.ReactNode
  initialSearchTerm?: string
  initialUseCase?: string
  initialLibrary?: string
  initialCategory?: string
}

export function ComponentsFiltersContainer({
  children,
  initialSearchTerm = "",
  initialLibrary = "all",
  initialUseCase = "all",
  initialCategory = "all",
}: RenderProps) {
  const [searchTerm, setSearchTerm] = React.useState(initialSearchTerm)
  const [library, setLibrary] = React.useState(initialLibrary)
  const [useCase, setUseCase] = React.useState(initialUseCase)
  const [category, setCategory] = React.useState(initialCategory)

  const onSearch = debounce((value: string) => {
    setSearchTerm(value)
  }, 150)

  function onUseCaseChange(useCase: string) {
    setUseCase(useCase)
  }

  function onLibraryChange(category: string) {
    setLibrary(category)
  }

  function onCategoryChange(category: string) {
    setCategory(category)
  }

  return typeof children === "function"
    ? children({
        searchTerm,
        onSearch,
        library,
        onLibraryChange,
        useCase,
        onUseCaseChange,
        category,
        onCategoryChange,
      })
    : children
}
