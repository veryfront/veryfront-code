import * as React from "react";
import { cn } from "../../theme.ts";
import { CodeBracketsIcon, FileTextIcon, TargetIcon } from "../../icons/index.ts";

export interface QuickAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  prompt?: string;
}

export interface QuickActionsProps {
  actions?: QuickAction[];
  onActionClick?: (action: QuickAction) => void;
  className?: string;
}

const defaultIconMap: Record<string, React.ReactNode> = {
  "ask-question": <CodeBracketsIcon className="size-4" />,
  "extract-insights": <TargetIcon className="size-4" />,
  "find-sources": <FileTextIcon className="size-4" />,
};

const defaultActions: QuickAction[] = [
  {
    id: "ask-question",
    label: "Ask Question",
    prompt: "I have a question about this document: ",
  },
  {
    id: "extract-insights",
    label: "Extract Insights",
    prompt: "Extract the key insights from the uploaded documents.",
  },
  {
    id: "find-sources",
    label: "Find Sources",
    prompt: "Find relevant sources and references in the documents for: ",
  },
];

export function QuickActions({
  actions = defaultActions,
  onActionClick,
  className,
}: QuickActionsProps): React.ReactElement {
  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
    >
      {actions.map((action) => {
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onActionClick?.(action)}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-all hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
