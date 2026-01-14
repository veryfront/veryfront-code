import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import Fuse from "https://esm.sh/fuse.js@7.0.0"
import { debounce } from "https://esm.sh/lodash-es@4.17.21"
import { SearchIcon, Loader2Icon } from "https://esm.sh/lucide-react"
import { Input } from "@/shared/ui/Input"
import { IntegrationRow } from "@/features/agent-builder/ui/IntegrationRow"
import { cn } from "@/shared/utils/utils"

type Integration = {
  name: string
  displayName: string
  icon: string
  description: string
  authType: string
  toolCount: number
  promptCount: number
}

type Step2IntegrationsProps = {
  value: string[]
  onChange: (value: string[]) => void
}

export function Step2Integrations({ value, onChange }: Step2IntegrationsProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  const { data, isLoading } = useQuery<Integration[]>({
    queryKey: ["integrations"],
    queryFn: async () => {
      const response = await fetch(
        "https://api.veryfront.com/integrations?limit=100",
      )
      if (!response.ok) {
        throw new Error("Failed to fetch integrations")
      }
      const result = await response.json()
      return Array.isArray(result.integrations) ? result.integrations : []
    },
  })

  const integrations = Array.isArray(data) ? data : []

  const fuse = useMemo(
    () =>
      new Fuse(integrations, {
        keys: [
          { name: "displayName", weight: 0.7 },
          { name: "description", weight: 0.3 },
        ],
        threshold: 0.3,
        includeScore: true,
      }),
    [integrations],
  )

  const debouncedSearch = useMemo(
    () =>
      debounce((searchValue: string) => {
        setDebouncedQuery(searchValue)
      }, 300),
    [],
  )

  const filteredIntegrations = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return integrations
    }
    const results = fuse.search(debouncedQuery)
    return results.map((result) => result.item)
  }, [debouncedQuery, fuse, integrations])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const searchValue = e.target.value
    setSearchQuery(searchValue)
    debouncedSearch(searchValue)
  }

  const handleClear = () => {
    setSearchQuery("")
    setDebouncedQuery("")
  }

  const handleToggle = (integrationName: string, checked: boolean) => {
    if (checked) {
      onChange([...value, integrationName])
    } else {
      onChange(value.filter((name) => name !== integrationName))
    }
  }

  const hasNoResults = !isLoading && filteredIntegrations.length === 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          <span>Loading integrations...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="px-0.5">
        <Input
          type="text"
          placeholder="Search integrations..."
          value={searchQuery}
          onChange={handleSearchChange}
          onClear={handleClear}
          withClear
          beforeIcon={<SearchIcon className="size-4" />}
        />
      </div>

      <div className={cn(
        "max-h-[400px] overflow-y-auto divide-y divide-border rounded-lg border border-border",
        hasNoResults && "border-0"
      )}>
        {hasNoResults ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-center">
              No integrations found matching your search.
            </p>
          </div>
        ) : (
          filteredIntegrations.map((integration) => {
            const checked = value.includes(integration.name)
            return (
              <IntegrationRow
                key={integration.name}
                integration={integration}
                checked={checked}
                onCheckedChange={(checked) => handleToggle(integration.name, checked)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
