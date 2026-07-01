/**
 * AgentCard — a running agent rendered as a `Card` wrapping the `Message`
 * anatomy: a header row (agent Avatar + name on the left, `<Status>` on the
 * right) over the agent's reasoning, tool calls, and message text. Composed
 * entirely from the shared primitives — `Card`, `Avatar`, `Status`,
 * `Reasoning`, `ToolCall`, `Markdown` — so it reads like a `Message` inside a
 * card (mirrors Studio's agent/message anatomy).
 *
 * @module react/components/chat/agent-card
 */
import * as React from "react";
import type { AgentMessage, AgentStatus, ToolCall } from "#veryfront/agent";
import type { ChatToolPart } from "#veryfront/agent/react";
import { cn } from "./theme.ts";
import { Avatar } from "./ui/avatar.tsx";
import { Card } from "./ui/card.tsx";
import { Status, type StatusColor } from "./ui/status.tsx";
import { Markdown } from "./markdown.tsx";
import { ReasoningCard } from "./chat/components/reasoning.tsx";
import { ToolCallCard } from "./chat/components/tool-ui.tsx";

/** Props accepted by agent card. */
export interface AgentCardProps {
  /** Agent display name shown in the header (default "Agent"). */
  name?: string;
  /** Agent avatar image; falls back to an initial. */
  avatarUrl?: string;
  /** Agent messages — rendered as Markdown, mirroring `Message.Content`. */
  messages?: AgentMessage[];
  /** Tool calls — rendered through the shared `ToolCall` card. */
  toolCalls?: ToolCall[];
  /** Agent status — drives the header `Status` dot + label. */
  status: AgentStatus;
  /** Thinking/reasoning text — rendered through the `Reasoning` component. */
  thinking?: string;
  /** Additional class name for the card. */
  className?: string;
  /** Custom tool renderer — overrides the default `ToolCall` card. */
  renderTool?: (toolCall: ToolCall) => React.ReactNode;
}

/** Map the agent status to a `Status` dot colour, label, and pulse. */
function statusPresentation(
  status: AgentStatus,
): { color: StatusColor; label: string; pulse: boolean } {
  switch (status) {
    case "thinking":
      return { color: "blue", label: "Thinking", pulse: true };
    case "tool_execution":
      return { color: "yellow", label: "Running tools", pulse: true };
    case "streaming":
      return { color: "green", label: "Responding", pulse: true };
    case "completed":
      return { color: "green", label: "Completed", pulse: false };
    case "error":
      return { color: "red", label: "Error", pulse: false };
    case "idle":
    default:
      return { color: "gray", label: "Idle", pulse: false };
  }
}

const TOOL_STATE: Record<ToolCall["status"], ChatToolPart["state"]> = {
  pending: "input-available",
  executing: "input-streaming",
  completed: "output-available",
  error: "output-error",
};

/** Adapt an agent `ToolCall` to the `ToolCall` card's `ChatToolPart` shape. */
function toToolPart(tool: ToolCall): ChatToolPart {
  return {
    type: `tool-${tool.name}`,
    toolCallId: tool.id,
    toolName: tool.name,
    state: TOOL_STATE[tool.status],
    input: tool.args,
    output: tool.result,
    errorText: tool.error,
  } as ChatToolPart;
}

/** Extract plain text from an agent message's parts. */
function messageText(message: AgentMessage): string {
  return message.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("") ?? "";
}

/** Render an agent card (a `Card` wrapping the `Message` anatomy). */
export const AgentCard = React.forwardRef<HTMLDivElement, AgentCardProps>(
  function AgentCard(
    {
      name = "Agent",
      avatarUrl,
      messages,
      toolCalls = [],
      status,
      thinking,
      className,
      renderTool,
    },
    ref,
  ) {
    const presentation = statusPresentation(status);

    return (
      <Card
        ref={ref}
        surface="outline"
        padding="md"
        className={cn("flex flex-col gap-3", className)}
      >
        {
          /* Header — Avatar + name (left), Status (right). Mirrors
            `ChatMessageHeader` / `Message.Header`. */
        }
        <div className="flex items-center gap-2">
          <Avatar name={name} avatarSrc={avatarUrl} className="size-8" />
          <span className="min-w-0 truncate font-medium text-[var(--foreground)]">
            {name}
          </span>
          <Status
            className="ml-auto"
            color={presentation.color}
            label={presentation.label}
            pulse={presentation.pulse}
          />
        </div>

        {/* Reasoning */}
        {thinking ? <ReasoningCard text={thinking} /> : null}

        {/* Tool calls */}
        {toolCalls.length > 0
          ? (
            <div className="flex flex-col">
              {toolCalls.map((tool) => (
                <React.Fragment key={tool.id}>
                  {renderTool ? renderTool(tool) : <ToolCallCard tool={toToolPart(tool)} />}
                </React.Fragment>
              ))}
            </div>
          )
          : null}

        {/* Message text — rendered as Markdown, like `Message.Content`. */}
        {messages && messages.length > 0
          ? (
            <div className="flex flex-col gap-2">
              {messages.map((message) => {
                const text = messageText(message);
                if (!text) return null;
                return (
                  <Markdown key={message.id} className="text-[15px] leading-7">
                    {text}
                  </Markdown>
                );
              })}
            </div>
          )
          : null}
      </Card>
    );
  },
);

AgentCard.displayName = "AgentCard";
