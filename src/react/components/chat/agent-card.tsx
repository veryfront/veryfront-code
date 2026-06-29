import * as React from "react";
import {
  AgentContainer,
  AgentStatus as AgentStatusPrimitive,
  ThinkingIndicator,
  ToolInvocation,
  ToolResult,
} from "../../primitives/index.ts";
import type { AgentMessage, AgentStatus, ToolCall } from "#veryfront/agent";
import { type AgentTheme, cn, defaultAgentTheme, mergeThemes } from "./theme.ts";

/** Props accepted by agent card. */
export interface AgentCardProps {
  /** Agent messages */
  messages?: AgentMessage[];

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

/** Render agent card. */
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
          input={tool.args}
          className={theme.tool}
        >
          {tool.result !== undefined
            ? <ToolResult output={tool.result} className={theme.toolResult} />
            : null}

          {tool.error
            ? (
              <div className="mt-2 rounded-[var(--radius-md)] border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                Error: {tool.error}
              </div>
            )
            : null}
        </ToolInvocation>
      ));

    const hasToolCalls = toolCalls.length > 0;
    const hasMessages = (messages?.length ?? 0) > 0;

    return (
      <AgentContainer ref={ref} className={cn(theme.container, className)}>
        <AgentStatusPrimitive
          status={status}
          className={cn(theme.status, getStatusColor(status))}
        />

        {thinking
          ? (
            <ThinkingIndicator className={theme.thinking}>
              <span className="font-semibold">Thinking:</span>
              {thinking}
            </ThinkingIndicator>
          )
          : null}

        {hasToolCalls
          ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                Tool Calls
              </h3>
              <div className="space-y-3">
                {toolCalls.map((tool) => (
                  <React.Fragment key={tool.id}>
                    {toolRenderer(tool)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )
          : null}

        {hasMessages
          ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                Messages
              </h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {messages?.map((msg) => {
                  const text = msg.parts
                    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
                    .map((p) => p.text)
                    .join("") ?? "";
                  return (
                    <div
                      key={msg.id}
                      className="rounded-[var(--radius-md)] bg-[var(--tertiary)] p-3 text-sm"
                    >
                      <span className="font-medium capitalize text-[var(--foreground)]">
                        {msg.role}:
                      </span>
                      <span className="ml-1 text-[var(--foreground)]">
                        {text.substring(0, 200)}
                        {text.length > 200 ? "..." : ""}
                      </span>
                    </div>
                  );
                })}
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
      return "bg-[var(--tertiary)] text-[var(--foreground)]";
    case "thinking":
      return "bg-blue-100 text-blue-700";
    case "tool_execution":
      return "bg-violet-100 text-violet-700";
    case "streaming":
      return "bg-green-100 text-green-700";
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "error":
      return "bg-red-100 text-red-700";
    default:
      return "bg-[var(--tertiary)] text-[var(--foreground)]";
  }
}
