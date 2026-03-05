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
  "ask-question": <CodeBracketsIcon className="size-5" />,
  "extract-insights": <TargetIcon className="size-5" />,
  "find-sources": <FileTextIcon className="size-5" />,
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
      className={cn("w-full max-w-2xl mx-auto px-4 grid grid-cols-3 gap-3", className)}
    >
      {actions.map((action) => {
        const icon = action.icon ?? defaultIconMap[action.id];
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onActionClick?.(action)}
            className="flex flex-col items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-center transition-all hover:bg-[var(--accent)] hover:border-[var(--input-border)] hover:shadow-sm min-h-[88px]"
          >
            {icon && (
              <span className="flex items-center justify-center size-8 rounded-lg bg-[var(--accent)] text-[var(--muted-foreground)] mb-2">
                {icon}
              </span>
            )}
            <span className="text-sm font-medium text-[var(--card-foreground)]">
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
