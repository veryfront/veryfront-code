import * as React from "react";
import type { AgentStatus as AgentStatusType } from "../../agent/index.js";

export interface AgentContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const AgentContainer = React.forwardRef<HTMLDivElement, AgentContainerProps>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={className} data-agent-container="" {...props}>
      {children}
    </div>
  ),
);

AgentContainer.displayName = "AgentContainer";

export interface AgentStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  status: AgentStatusType;
  label?: string;
}

export const AgentStatus = React.forwardRef<HTMLDivElement, AgentStatusProps>(
  ({ className, status, label, ...props }, ref) => {
    const displayLabel = label ?? formatStatus(status);

    return (
      <div
        ref={ref}
        className={className}
        data-agent-status=""
        data-status={status}
        role="status"
        aria-label={`Agent status: ${displayLabel}`}
        {...props}
      >
        {displayLabel}
      </div>
    );
  },
);

AgentStatus.displayName = "AgentStatus";

export interface ThinkingIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export const ThinkingIndicator = React.forwardRef<HTMLDivElement, ThinkingIndicatorProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={className}
      data-thinking-indicator=""
      role="status"
      aria-live="polite"
      {...props}
    >
      {children}
    </div>
  ),
);

ThinkingIndicator.displayName = "ThinkingIndicator";

function formatStatus(status: AgentStatusType): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "thinking":
      return "Thinking...";
    case "tool_execution":
      return "Using tools...";
    case "streaming":
      return "Responding...";
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    default:
      return String(status);
  }
}
