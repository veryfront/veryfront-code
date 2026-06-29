import * as React from "react";
import { cn } from "../../theme.ts";

/** Public API contract for quick action. */
export interface QuickAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  prompt?: string;
}

/** Props accepted by quick actions. */
export interface QuickActionsProps {
  actions?: QuickAction[];
  onActionClick?: (action: QuickAction) => void;
  className?: string;
}

/** Render quick actions. */
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
          className="rounded-full border border-[var(--outline-border)] px-4 py-2 text-sm text-[var(--faint)] transition-colors hover:border-[var(--edge-medium)] hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
