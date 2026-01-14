import { useState, useMemo, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import Fuse from "https://esm.sh/fuse.js@7.0.0"
import { debounce } from "https://esm.sh/lodash-es@4.17.21"
import { Loader2Icon, SearchIcon } from "https://esm.sh/lucide-react"
import { IntegrationRow } from "@/features/agent-builder/ui/IntegrationRow"
import { Input } from "@/shared/ui/Input"
import { Button } from "@/shared/ui/Button"
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

type ConnectIntegrationsStepProps = {
  selectedIntegrations: string[]
  onToggle: (integrationName: string, checked: boolean) => void
  onNext: () => void
}

export function ConnectIntegrationsStep({
  selectedIntegrations,
  onToggle,
  onNext,
}: ConnectIntegrationsStepProps) {
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

  // Sort to show Gmail first if it's selected
  const sortedIntegrations = useMemo(() => {
    return [...filteredIntegrations].sort((a, b) => {
      const aSelected = selectedIntegrations.includes(a.name)
      const bSelected = selectedIntegrations.includes(b.name)
      if (aSelected && !bSelected) return -1
      if (!aSelected && bSelected) return 1
      return 0
    })
  }, [filteredIntegrations, selectedIntegrations])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const searchValue = e.target.value
    setSearchQuery(searchValue)
    debouncedSearch(searchValue)
  }

  const handleClear = () => {
    setSearchQuery("")
    setDebouncedQuery("")
  }

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight mb-10">
        2. Connect Integrations
      </h2>

      <div className="mb-4">
        <Input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          onClear={handleClear}
          placeholder="Search integrations..."
          withClear
          beforeIcon={<SearchIcon className="size-4" />}
        />
      </div>

      <div className="h-[500px] min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-input-border scrollbar-track-transparent border border-border rounded-lg bg-input">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-muted">
              <Loader2Icon className="size-4 animate-spin" />
              <span>Loading integrations...</span>
            </div>
          </div>
        ) : sortedIntegrations.length > 0 ? (
          <div>
            {sortedIntegrations.map((integration, idx) => (
              <div
                key={integration.name}
                className={cn(
                  idx < sortedIntegrations.length - 1
                    ? "border-b border-border"
                    : "",
                  selectedIntegrations.includes(integration.name) && "bg-accent/20"
                )}
              >
                <IntegrationRow
                  integration={integration}
                  checked={selectedIntegrations.includes(integration.name)}
                  onCheckedChange={(checked) =>
                    onToggle(integration.name, checked)
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-[#6e6e73]">
            No integrations found
          </div>
        )}
      </div>

      <div className="flex justify-start mt-10">
        <Button type="button" onClick={onNext} variant="outline" size="lg">
          Next
        </Button>
      </div>
    </>
  )
}
