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

export const DEFAULT_SORT = "name:ASC"
export const DEFAULT_CATEGORY = "all"

const categoryOptions = [
  { name: "All Categories", value: "all" },
  { name: "Application", value: "Application" },
  { name: "Marketing", value: "Marketing" },
  { name: "Store", value: "Store" },
  { name: "Survey", value: "Survey" },
]

interface TemplatesFiltersProps {
  sort: string
  category: string
  onSort: (sort: string) => void
  onCategory: (category: string) => void
  onSearch: (search: string) => void
  className?: string
}

export function TemplatesFilters({
  category,
  onCategory,
  onSearch,
  className,
}: TemplatesFilterProps) {
  const activeCategory = categoryOptions.find(
    (option) => option.value === category || DEFAULT_CATEGORY,
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
        Search templates
      </label>
      <div className="max-sm:w-full max-lg:self-start max-w-96 flex-1">
        <Input
          ref={inputRef}
          id="search"
          name="search"
          placeholder="Search templates..."
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
        <Select value={category} onValueChange={onCategory}>
          <SelectTrigger
            variant="outline"
            size="md"
            className="shrink-0 min-w-30"
          >
            <SelectValue placeholder={activeCategory.name} />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {categoryOptions?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </form>
  )
}
