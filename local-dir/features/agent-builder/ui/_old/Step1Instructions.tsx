import { useState, useEffect } from "react"
import { Textarea } from "@/shared/ui/Textarea"
import { Button } from "@/shared/ui/Button"
import { MailIcon, InboxIcon, TagIcon, CalendarIcon, FilterIcon } from "https://esm.sh/lucide-react"

type EmailTask = {
  id: string
  icon: React.ElementType
  label: string
  description: string
  instructions: string
  model: string
}

const EMAIL_TASKS: EmailTask[] = [
  {
    id: "inbox-zero",
    icon: InboxIcon,
    label: "Inbox Zero Assistant",
    description: "Archive, label, and prioritize emails",
    instructions: `You are an Inbox Zero Assistant focused on helping users achieve and maintain an empty inbox.

Your responsibilities:
- Scan unread emails and categorize them by priority (urgent, important, routine, low-priority)
- Archive or label emails that don't require immediate action
- Draft brief responses for routine inquiries
- Flag emails that need user attention with clear reasoning
- Identify and unsubscribe from unwanted mailing lists

Always be proactive, decisive, and help the user focus on what truly matters.`,
    model: "gpt-4o"
  },
  {
    id: "meeting-scheduler",
    icon: CalendarIcon,
    label: "Meeting Scheduler",
    description: "Extract and schedule meeting requests",
    instructions: `You are a Meeting Scheduler that helps users manage calendar invites and scheduling requests via email.

Your responsibilities:
- Identify emails containing meeting requests or calendar invites
- Extract key details: proposed times, attendees, meeting purpose, duration
- Check for scheduling conflicts and suggest alternative times if needed
- Draft professional responses to accept, decline, or propose new times
- Create calendar event summaries with all relevant information

Be courteous, efficient, and always confirm details before taking action.`,
    model: "gpt-4o"
  },
  {
    id: "newsletter-digest",
    icon: FilterIcon,
    label: "Newsletter Digest",
    description: "Summarize newsletters and updates",
    instructions: `You are a Newsletter Digest Assistant that processes newsletters, industry updates, and promotional emails.

Your responsibilities:
- Identify newsletter and bulk email content
- Extract key takeaways, important announcements, and actionable items
- Create concise summaries (3-5 bullet points per newsletter)
- Group related content from multiple newsletters
- Flag time-sensitive offers or deadlines

Keep summaries clear, scannable, and focused on what the user needs to know.`,
    model: "gpt-4o-mini"
  },
  {
    id: "smart-labels",
    icon: TagIcon,
    label: "Smart Labeler",
    description: "Auto-categorize and organize emails",
    instructions: `You are a Smart Labeling Assistant that automatically organizes incoming emails with intelligent labels.

Your responsibilities:
- Analyze email content, sender, and subject to determine appropriate labels
- Apply consistent labeling conventions (Work, Personal, Finance, Travel, etc.)
- Create new label suggestions for recurring email patterns
- Identify emails that belong to multiple categories
- Flag emails that might be spam or phishing attempts

Be systematic, consistent, and help maintain a well-organized email system.`,
    model: "gpt-4o-mini"
  }
]

type Step1InstructionsProps = {
  value: string
  onChange: (value: string) => void
  onTaskSelect?: (task: EmailTask) => void
}

export function Step1Instructions({ value, onChange, onTaskSelect }: Step1InstructionsProps) {
  const [tokenCount, setTokenCount] = useState(0)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  useEffect(() => {
    // Rough token estimate: ~4 chars per token
    const estimatedTokens = Math.ceil(value.length / 4)
    setTokenCount(estimatedTokens)
  }, [value])

  const handleTaskSelect = (task: EmailTask) => {
    setSelectedTaskId(task.id)
    onChange(task.instructions)
    onTaskSelect?.(task)
  }

  return (
    <div className="space-y-6">
      {/* Pre-configured Email Task Buttons */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MailIcon className="size-4 text-primary" />
          <span>Quick Start: Gmail Tasks</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EMAIL_TASKS.map((task) => {
            const Icon = task.icon
            const isSelected = selectedTaskId === task.id
            return (
              <Button
                key={task.id}
                variant={isSelected ? "default" : "outline"}
                className="h-auto flex-col items-start gap-1.5 p-3 text-left"
                onClick={() => handleTaskSelect(task)}
              >
                <div className="flex items-center gap-2">
                  <Icon className="size-4" />
                  <span className="font-medium text-sm">{task.label}</span>
                </div>
                <span className="text-xs opacity-80 font-normal">
                  {task.description}
                </span>
              </Button>
            )
          })}
        </div>
      </div>

      {/* Instructions Textarea */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="instructions" className="text-sm font-medium">
            Agent Instructions
          </label>
          <p className="text-sm text-muted-foreground">
            {tokenCount} tokens
          </p>
        </div>
        <Textarea
          id="instructions"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setSelectedTaskId(null) // Clear selection when manually editing
          }}
          placeholder="Define your Gmail agent's behavior and tasks, or select a quick start template above..."
          rows={12}
          className="resize-none font-mono text-sm placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}
