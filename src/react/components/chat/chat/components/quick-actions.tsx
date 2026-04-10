import * as React from "react";
import { cn } from "../../theme.ts";

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

export function QuickActions({
  actions,
  onActionClick,
  className,
}: QuickActionsProps): React.ReactElement | null {
  if (!actions || actions.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onActionClick?.(action)}
          className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--foreground)]/[0.03] hover:text-[var(--foreground)] hover:border-[var(--input-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
