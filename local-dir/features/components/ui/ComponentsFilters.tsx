import { Search } from "https://esm.sh/lucide-react"
import { Input } from "@/shared/ui/Input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/Select"
import { cn } from "@/shared/utils/utils"
import React from "react"
import {
  librariesConfig,
  useCasesConfig,
  categoriesConfig,
} from "@/shared/utils/componentsConfig"

const libraryOptions = [
  {
    id: "all",
    title: "All Libraries",
  },
  ...librariesConfig,
]

const useCaseOptions = [
  {
    id: "all",
    title: "All Use Cases",
  },
  ...useCasesConfig.filter((u) => !u.isDisabled),
]

const categoryOptions = [
  {
    id: "all",
    title: "All Categories",
  },
  ...categoriesConfig,
]

export const DEFAULT_SORT = "name:ASC"
export const DEFAULT_USE_CASE = "all"
export const DEFAULT_LIBRARY = "all"
export const DEFAULT_CATEGORY = "all"

interface ComponentsFiltersProps {
  sort: string
  onSort: (sort: string) => void
  library: string
  onLibraryChange: (library: string) => void
  showLibraries?: boolean
  useCase: string
  onUseCaseChange: (useCase: string) => void
  showUseCases?: boolean
  category: string
  onCategoryChange: (category: string) => void
  showCategories?: boolean
  onSearch: (search: string) => void
  className?: string
}

export function ComponentsFilters({
  library,
  onLibraryChange,
  showLibraries = true,
  useCase,
  onUseCaseChange,
  showUseCases = true,
  category,
  onCategoryChange,
  showCategories = true,
  onSearch,
  className,
  isLoading,
}: TemplatesFilterProps) {
  const activeUseCase = useCaseOptions.find(
    (option) => option.id === useCase || DEFAULT_USE_CASE,
  )
  const activeLibrary = libraryOptions.find(
    (option) => option.id === library || DEFAULT_LIBRARY,
  )
  const activeCategory = categoryOptions.find(
    (option) => option.id === category || DEFAULT_CATEGORY,
  )
  const inputRef = React.useRef<HTMLInputElement>(null)

  return (
    <form
      className={cn(
        "flex flex-col xs:flex-row items-center sm:items-end gap-2 md:gap-3",
        className,
      )}
      onSubmit={(e) => e.preventDefault()}
    >
      <label htmlFor="search" className="sr-only">
        Search components
      </label>
      <div className="max-sm:w-full max-lg:self-start max-w-96 flex-1">
        <Input
          ref={inputRef}
          id="search"
          name="search"
          placeholder="Search components..."
          beforeIcon={<Search className="w-4 h-4" />}
          variant="outline"
          onChange={(e) => onSearch(e.target.value)}
          withClear
          onClear={() => {
            onSearch?.("")
            inputRef.current.value = ""
          }}
        />
      </div>
      <div className="flex flex-1 max-sm:w-full gap-2 md:gap-3">
        {showLibraries && (
          <Select value={library} onValueChange={onLibraryChange}>
            <SelectTrigger
              variant="outline"
              size="md"
              className="shrink-0 min-w-30"
            >
              <SelectValue placeholder={activeLibrary.title} />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {libraryOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        {showUseCases && (
          <Select value={useCase} onValueChange={onUseCaseChange}>
            <SelectTrigger
              variant="outline"
              size="md"
              className="shrink-0 min-w-30"
            >
              <SelectValue placeholder={activeUseCase.title} />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {useCaseOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        {showCategories && (
          <Select value={category} onValueChange={onCategoryChange}>
            <SelectTrigger
              variant="outline"
              size="md"
              className="shrink-0 min-w-30"
            >
              <SelectValue placeholder={activeCategory.title} />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>
    </form>
  )
}
