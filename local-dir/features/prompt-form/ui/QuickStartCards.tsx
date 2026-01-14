import {
  Bot,
  Image,
  Mic,
  Video,
  FileText,
  Search,
  MapPin,
  Palette,
  Zap,
  MessageSquare,
  Film,
  Crop,
  ScanLine,
  Volume2,
  Brain,
  AudioLines,
  ShoppingBag,
  Mail,
  BarChart3,
  Link,
} from "https://esm.sh/lucide-react"
import { Text } from "@/shared/ui/Text"

interface QuickStartCardsProps {
  isRedirecting: boolean
  setIsRedirecting: (value: boolean) => void
}

const prompts = [
  {
    icon: ShoppingBag,
    title: "Customer Service Agent",
    description: "Helpful customer service agent that resolves inquiries quickly and professionally. Access customer data, create tickets, and escalate issues with empathy.",
    integrations: "ServiceNow, Zendesk, Intercom, Slack",
    model: "Claude 3.5 Sonnet",
    prompt: "Create a customer service AI agent with ticket management and escalation capabilities",
    color: "bg-blue-50 border-blue-100 text-blue-600",
    hoverColor: "hover:bg-blue-100 hover:border-blue-200",
  },
  {
    icon: Mail,
    title: "Email Management Agent", 
    description: "Process incoming emails, categorize by priority, draft contextual responses, and schedule follow-ups with professional tone.",
    integrations: "Outlook, Gmail, Salesforce, HubSpot",
    model: "GPT-4",
    prompt: "Build an email management agent that processes and responds to emails intelligently",
    color: "bg-green-50 border-green-100 text-green-600",
    hoverColor: "hover:bg-green-100 hover:border-green-200",
  },
  {
    icon: ShoppingBag,
    title: "Sales Automation Agent",
    description: "Qualify leads, schedule meetings, and create personalized follow-up sequences using prospect behavior data and relationship-focused approach.", 
    integrations: "Salesforce, HubSpot, Pipedrive, Calendly",
    model: "GPT-4o",
    prompt: "Create a sales automation agent that qualifies leads and manages follow-ups",
    color: "bg-purple-50 border-purple-100 text-purple-600", 
    hoverColor: "hover:bg-purple-100 hover:border-purple-200",
  },
  {
    icon: BarChart3,
    title: "Data Analysis Agent",
    description: "Process reports, identify trends and anomalies, generate executive summaries with actionable insights in clear, visual formats.",
    integrations: "Databricks, Snowflake, Tableau, Power BI",
    model: "Claude 3.5 Sonnet",
    prompt: "Build a data analysis agent that generates insights and visualizations from data",
    color: "bg-orange-50 border-orange-100 text-orange-600",
    hoverColor: "hover:bg-orange-100 hover:border-orange-200",
  },
]

export function QuickStartCards({
  isRedirecting,
  setIsRedirecting,
}: QuickStartCardsProps) {
  const handleCardClick = (prompt: string) => {
    try {
      sessionStorage.setItem("prompt", prompt)
      setIsRedirecting(true)
      const url = new URL("https://new.veryfront.com")
      url.searchParams.set("prompt", "session")
      window.location.href = url.toString()
    } catch {
      const url = new URL("https://new.veryfront.com")
      url.searchParams.set("prompt", prompt)
      window.location.href = url.toString()
    }
  }

  return (
    <div className="w-full">
      <div className="text-center mb-12">
        <Text level="1" className="font-medium text-xl">
          Ready-to-use AI Agents
        </Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto">
        {prompts.map((item, index) => {
          const IconComponent = item.icon
          return (
            <button
              key={index}
              onClick={() => handleCardClick(item.prompt)}
              disabled={isRedirecting}
              className={`group bg-white border rounded-2xl p-8 text-left transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed w-full shadow-sm hover:shadow-lg ${item.color} ${item.hoverColor}`}
            >
              <div className="flex flex-col space-y-6">
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${item.color} group-hover:scale-105 transition-transform duration-200`}>
                    <IconComponent className="size-6 font-medium" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-lg mb-2 leading-tight">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Link className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {item.integrations}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {item.model}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
