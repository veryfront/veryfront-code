import { Bot, Camera, Mail, BarChart3, Zap, Database, Settings } from "https://esm.sh/lucide-react"
import { TemplatesIcon } from "@/shared/ui/icons/TemplatesIcon"
import { cn } from "@/shared/utils/utils"

interface ChatQuickStartProps {
  onCloneScreenshotClick: () => void
  isCloneScreenshotUploading: boolean
  isRedirecting: boolean
  setIsRedirecting: (value: boolean) => void
  className?: string
}

export function ChatQuickStart({
  onCloneScreenshotClick,
  isCloneScreenshotUploading,
  isRedirecting,
  setIsRedirecting,
  className
}: ChatQuickStartProps) {
  const handlePromptClick = (prompt: string) => {
    const textarea = document.querySelector('#prompt') as HTMLTextAreaElement
    if (textarea) {
      textarea.value = prompt
      textarea.focus()
      // Trigger the onChange event
      const event = new Event('input', { bubbles: true })
      textarea.dispatchEvent(event)
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-5xl mx-auto">
        <button
          onClick={() => handlePromptClick("You are a ServiceNow automation agent. Your role is to manage IT service requests, resolve incidents, and handle change management workflows. Access ServiceNow data, create tickets, escalate issues, and update service requests with professional efficiency.")}
          disabled={isRedirecting}
          className={cn(
            "group relative text-left",
            "bg-background/60 backdrop-blur-sm border border-border/30 rounded-lg p-4",
            "hover:border-border/50 hover:bg-background/80",
            "focus:outline-none focus:ring-1 focus:ring-border/50",
            "transition-all duration-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg overflow-hidden mt-1">
              <img 
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/01c7ce2f-a8ab-44c6-8510-294ddf14222b.webp"
                alt="ServiceNow Agent"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <h3 className="font-medium text-foreground text-sm mb-2">
                  ServiceNow Agent
                </h3>
                <p className="text-muted text-xs leading-relaxed">
                  Automate IT service management, handle incident resolution, and manage change requests with ServiceNow integration.
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="size-3 text-muted" />
                  <span className="text-xs text-muted">ServiceNow</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="size-3 text-muted" />
                  <span className="text-xs text-muted">Claude Opus 4.5</span>
                </div>
              </div>
            </div>
          </div>
        </button>

        <button
          onClick={() => handlePromptClick("You are an Outlook email assistant. Your role is to process incoming emails, categorize by priority, draft professional responses, and schedule follow-ups. Integrate with Outlook calendar and contacts for comprehensive email management.")}
          disabled={isRedirecting}
          className={cn(
            "group relative text-left",
            "bg-background/60 backdrop-blur-sm border border-border/30 rounded-lg p-4",
            "hover:border-border/50 hover:bg-background/80",
            "focus:outline-none focus:ring-1 focus:ring-border/50",
            "transition-all duration-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg overflow-hidden mt-1">
              <img 
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/f3059096-32ce-4508-b20e-c6a150c696a0.webp"
                alt="Outlook Agent"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <h3 className="font-medium text-foreground text-sm mb-2">
                  Outlook Agent
                </h3>
                <p className="text-muted text-xs leading-relaxed">
                  Streamline email management with intelligent categorization, automated responses, and calendar integration.
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="size-3 text-muted" />
                  <span className="text-xs text-muted">Outlook</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="size-3 text-muted" />
                  <span className="text-xs text-muted">GPT-5</span>
                </div>
              </div>
            </div>
          </div>
        </button>

        <button
          onClick={() => handlePromptClick("You are a Salesforce automation specialist. Your role is to manage leads, opportunities, and customer relationships. Qualify prospects, update deal stages, schedule meetings, and create personalized follow-up sequences using Salesforce CRM data.")}
          disabled={isRedirecting}
          className={cn(
            "group relative text-left",
            "bg-background/60 backdrop-blur-sm border border-border/30 rounded-lg p-4",
            "hover:border-border/50 hover:bg-background/80",
            "focus:outline-none focus:ring-1 focus:ring-border/50",
            "transition-all duration-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg overflow-hidden mt-1">
              <img 
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/17c7ba8c-34b1-40fc-8145-8a4c4bb5b150.png"
                alt="Salesforce Agent"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <h3 className="font-medium text-foreground text-sm mb-2">
                  Salesforce Agent
                </h3>
                <p className="text-muted text-xs leading-relaxed">
                  Automate CRM workflows, manage sales pipelines, and enhance customer relationships through Salesforce integration.
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="size-3 text-muted" />
                  <span className="text-xs text-muted">Salesforce</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="size-3 text-muted" />
                  <span className="text-xs text-muted">o3</span>
                </div>
              </div>
            </div>
          </div>
        </button>

        <button
          onClick={() => handlePromptClick("You are a Jira project management agent. Your role is to track issues, manage sprints, and generate project reports. Create tickets, update project status, analyze team velocity, and provide insights on development workflows.")}
          disabled={isRedirecting}
          className={cn(
            "group relative text-left",
            "bg-background/60 backdrop-blur-sm border border-border/30 rounded-lg p-4",
            "hover:border-border/50 hover:bg-background/80",
            "focus:outline-none focus:ring-1 focus:ring-border/50",
            "transition-all duration-200",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg overflow-hidden mt-1">
              <img 
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/17328c7c-967a-4c86-9e5b-8fb6233ab05d.png"
                alt="Jira Agent"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <h3 className="font-medium text-foreground text-sm mb-2">
                  Jira Agent
                </h3>
                <p className="text-muted text-xs leading-relaxed">
                  Streamline project management with automated issue tracking, sprint planning, and development workflow insights.
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="size-3 text-muted" />
                  <span className="text-xs text-muted">Jira</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="size-3 text-muted" />
                  <span className="text-xs text-muted">Claude Sonnet 4.5</span>
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
