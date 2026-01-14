import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Switch } from "@/shared/ui/Switch"
import { WrenchIcon, Loader2Icon } from "https://esm.sh/lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/Tooltip"
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

type Tool = {
  name: string
  description: string
}

type IntegrationDetails = {
  tools: Tool[]
}

type IntegrationRowProps = {
  integration: Integration
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

const INVERTED_ICONS = [
  "aws",
  "anthropic",
  "github",
  "intercom",
  "linear",
  "mixpanel",
  "sentry",
  "sharepoint",
  "twilio",
  "twitter",
  "zendesk",
]

export function IntegrationRow({
  integration,
  checked,
  onCheckedChange,
}: IntegrationRowProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false)

  const { data, isLoading } = useQuery<IntegrationDetails>({
    queryKey: ["integration-details", integration.name],
    queryFn: async () => {
      const response = await fetch(
        `https://api.veryfront.com/integrations/${integration.name}`,
      )
      if (!response.ok) {
        throw new Error("Failed to fetch integration details")
      }
      return response.json()
    },
    enabled: tooltipOpen,
  })

  return (
    <div
      className="flex items-center gap-4 p-4 hover:bg-muted/10 transition-colors cursor-pointer"
      onClick={() => onCheckedChange(!checked)}
    >
      <img
        src={`https://api.veryfront.com/integrations/${integration.name}/icon`}
        alt={integration.displayName}
        className={cn(
          "w-8 h-8 rounded flex-shrink-0",
          INVERTED_ICONS.includes(integration.name) && "dark:invert",
        )}
      />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-foreground">
          {integration.displayName}
        </h3>
        <p className="text-sm text-muted-foreground">
          {integration.description}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <TooltipProvider delayDuration={200}>
          <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-1.5 text-gray-400 mr-2 cursor-help"
                onClick={(e) => e.stopPropagation()}
              >
                <WrenchIcon className="size-3.5" />
                <span className="text-sm">{integration.toolCount}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {isLoading ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2Icon className="size-3 animate-spin" />
                  <span className="text-xs">Loading tools...</span>
                </div>
              ) : data?.tools && data.tools.length > 0 ? (
                <div className="space-y-1.5 py-1">
                  <div className="font-semibold text-xs mb-2">
                    Available Tools:
                  </div>
                  {data.tools.map((tool) => (
                    <div key={tool.name} className="text-xs">
                      <div className="font-medium">{tool.name}</div>
                      <div className="text-muted-foreground text-[0.7rem]">
                        {tool.description}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs">No tools available</span>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
      </div>
    </div>
  )
}
