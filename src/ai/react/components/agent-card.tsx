/**
 * AgentCard Component - Layer 3 (Styled)
 *
 * Production-ready agent status and tool visualization.
 * Built on Layer 2 primitives.
 */

import * as React from "react";
import {
  AgentContainer,
  AgentStatus as AgentStatusPrimitive,
  ThinkingIndicator,
  ToolInvocation,
  ToolList,
  ToolResult,
} from "../primitives/index.ts";
import type { AgentStatus, Message, ToolCall } from "../../types/agent.ts";
import { type AgentTheme, cn, defaultAgentTheme, mergeThemes } from "./theme.ts";

export interface AgentCardProps {
  /** Agent messages */
  messages?: Message[];

  /** Tool calls */
  toolCalls?: ToolCall[];

  /** Agent status */
  status: AgentStatus;

  /** Thinking/reasoning text */
  thinking?: string;

  /** Additional class name */
  className?: string;

  /** Theme customization */
  theme?: Partial<AgentTheme>;

  /** Custom tool renderer */
  renderTool?: (toolCall: ToolCall) => React.ReactNode;
}

/**
 * AgentCard - Agent status and tool visualization
 *
 * @example
 * ```tsx
 * import { AgentCard } from 'veryfront/ai/components';
 * import { useAgent } from 'veryfront/ai/react';
 *
 * export default function AgentInterface() {
 *   const agent = useAgent({ agent: 'support' });
 *   return <AgentCard {...agent} />;
 * }
 * ```
 */
export const AgentCard = React.forwardRef<HTMLDivElement, AgentCardProps>(
  (
    {
      messages,
      toolCalls = [],
      status,
      thinking,
      className,
      theme: userTheme,
      renderTool,
    },
    ref,
  ) => {
    const theme = mergeThemes(defaultAgentTheme, userTheme);

    return (
      <AgentContainer ref={ref} className={cn(theme.container, className)}>
        {/* Status */}
        <AgentStatusPrimitive
          status={status}
          className={cn(theme.status, getStatusColor(status))}
        />

        {/* Thinking indicator */}
        {thinking && (
          <ThinkingIndicator className={theme.thinking}>
            <span className="font-semibold">Thinking:</span>
            {thinking}
          </ThinkingIndicator>
        )}

        {/* Tool calls */}
        {toolCalls.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Tool Calls
            </h3>
            <ToolList
              toolCalls={toolCalls}
              className="space-y-2"
              renderTool={renderTool ||
                ((tool) => (
                  <ToolInvocation
                    name={tool.name}
                    args={tool.args}
                    status={tool.status}
                    className={theme.tool}
                  >
                    {tool.result !== undefined && (
                      <ToolResult result={tool.result} className={theme.toolResult} />
                    )}
                    {tool.error && (
                      <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100 rounded text-sm">
                        Error: {tool.error}
                      </div>
                    )}
                  </ToolInvocation>
                ))}
            />
          </div>
        )}

        {/* Messages (if provided) */}
        {messages && messages.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Messages
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="text-sm p-2 rounded bg-gray-50 dark:bg-gray-900"
                >
                  <span className="font-semibold capitalize">{msg.role}:</span>
                  <span>{msg.content.substring(0, 200)}...</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </AgentContainer>
    );
  },
);

AgentCard.displayName = "AgentCard";

/**
 * Get status color classes
 */
function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case "idle":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    case "thinking":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "tool_execution":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
    case "streaming":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "error":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}
