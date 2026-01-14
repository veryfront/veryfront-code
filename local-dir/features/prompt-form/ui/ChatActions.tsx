import {
  Paperclip,
  Camera,
  Github,
  FolderOpen,
} from "https://esm.sh/lucide-react"
import { cn } from "@/shared/utils/utils"

interface ChatActionsProps {
  onAttachFileClick: () => void
  onCloneScreenshotClick: () => void
}

function ActionButton({ icon, title, onClick, children, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex p-2 py-1 gap-2 items-center text-[10px] rounded-lg",
        "bg-background border border-border/40",
        "hover:bg-accent/10 hover:border-border/70 hover:bg-primary/5",
        "focus:outline-none focus:ring-2 focus:ring-primary/20",
        "shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),0px_1px_0px_0px_rgba(25,28,33,0.02),0px_0px_0px_1px_rgba(25,28,33,0.08)]",
        "transition-all duration-200",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className="h-3 w-3 flex items-center justify-center">
        {icon}
      </div>
      {children}
    </button>
  )
}

export function ChatActions({
  onAttachFileClick,
  onCloneScreenshotClick,
}: ChatActionsProps) {
  return (
    <div className="flex gap-2">
      <ActionButton
        icon={<Paperclip className="h-3 w-3" />}
        title="Upload a file"
        onClick={onAttachFileClick}
      />

      <ActionButton
        icon={<Camera className="h-3 w-3" />}
        title="Take a screenshot"
        onClick={onCloneScreenshotClick}
      />

      <ActionButton
        icon={<Github className="h-3 w-3" />}
        title="Add from GitHub"
        disabled
      />

      <ActionButton
        icon={<FolderOpen className="h-3 w-3" />}
        title="Use a project"
        disabled
      />
    </div>
  )
}
