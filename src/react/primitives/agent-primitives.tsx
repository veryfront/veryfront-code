/**
 * Agent Primitives - Layer 2 (Unstyled)
 *
 * Primitives for displaying agent status and execution.
 * Built on Radix UI patterns (shadcn-compatible).
 */

import * as React from "react";
import type { AgentStatus as AgentStatusType } from "@veryfront/agent";

export interface AgentContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * AgentContainer - Root agent UI container
 *
 * @example
 * ```tsx
 * <AgentContainer className="border rounded-lg p-4">
 *   <AgentStatus status={agent.status} />
 *   <AgentMessages messages={agent.messages} />
 * </AgentContainer>
 * ```
 */
export const AgentContainer = React.forwardRef<
  HTMLDivElement,
  AgentContainerProps
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={className}
      data-agent-container=""
      {...props}
    >
      {children}
    </div>
  );
});

AgentContainer.displayName = "AgentContainer";

export interface AgentStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Current agent status */
  status: AgentStatusType;

  /** Custom label */
  label?: string;
}

/**
 * AgentStatus - Status indicator
 *
 * @example
 * ```tsx
 * <AgentStatus
 *   status={agent.status}
 *   className="text-sm font-medium"
 * />
 * ```
 */
export const AgentStatus = React.forwardRef<HTMLDivElement, AgentStatusProps>(
  ({ className, status, label, ...props }, ref) => {
    const displayLabel = label || formatStatus(status);

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
  /** Thinking text */
  children?: React.ReactNode;
}

/**
 * ThinkingIndicator - Shows when agent is thinking
 *
 * @example
 * ```tsx
 * {agent.thinking && (
 *   <ThinkingIndicator className="italic text-gray-600">
 *     {agent.thinking}
 *   </ThinkingIndicator>
 * )}
 * ```
 */
export const ThinkingIndicator = React.forwardRef<
  HTMLDivElement,
  ThinkingIndicatorProps
>(({ className, children, ...props }, ref) => {
  return (
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
  );
});

ThinkingIndicator.displayName = "ThinkingIndicator";

/**
 * Format status for display
 */
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
