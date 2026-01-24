import * as React from "react";
import {
  AgentContainer,
  AgentStatus as AgentStatusPrimitive,
  ThinkingIndicator,
  ToolInvocation,
  ToolList,
  ToolResult,
} from "../../primitives/index.ts";
import type { AgentStatus, Message, ToolCall } from "#veryfront/agent";
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

    const toolRenderer = renderTool ??
      ((tool: ToolCall) => (
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
            <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100 rounded-xl text-sm border border-red-200 dark:border-red-800">
              Error: {tool.error}
            </div>
          )}
        </ToolInvocation>
      ));

    return (
      <AgentContainer ref={ref} className={cn(theme.container, className)}>
        <AgentStatusPrimitive
          status={status}
          className={cn(theme.status, getStatusColor(status))}
        />

        {thinking && (
          <ThinkingIndicator className={theme.thinking}>
            <span className="font-semibold">Thinking:</span>
            {thinking}
          </ThinkingIndicator>
        )}

        {toolCalls.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Tool Calls
            </h3>
            <ToolList
              toolCalls={toolCalls}
              className="space-y-3"
              renderTool={toolRenderer}
            />
          </div>
        )}

        {messages?.length
          ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Messages
              </h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="text-sm p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800"
                  >
                    <span className="font-semibold capitalize text-neutral-900 dark:text-neutral-100">
                      {msg.role}:
                    </span>
                    <span className="text-neutral-600 dark:text-neutral-400 ml-1">
                      {msg.content.substring(0, 200)}...
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
          : null}
      </AgentContainer>
    );
  },
);

AgentCard.displayName = "AgentCard";

function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case "idle":
      return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
    case "thinking":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "tool_execution":
      return "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300";
    case "streaming":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "error":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    default:
      return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  }
}
