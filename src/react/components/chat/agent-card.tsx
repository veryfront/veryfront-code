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
// ---------------------------------------------------------------------------
// AgentCard — compound, render-or-compose (mirrors `ToolCall` / `Message`).
//
// `<AgentCard {...props} />` renders the default anatomy: `Header` (avatar +
// name + status) over `Reasoning`, `Tools`, and `Body` (the message text).
// Pass children to recompose from `AgentCard.Header`, `AgentCard.Reasoning`,
// `AgentCard.Tools`, `AgentCard.Body` — each reads `useAgentCard()`. Every
// sub-part takes `className`, merged LAST via `cn`. The preset `<AgentCard>`
// stays fully back-compatible.
// ---------------------------------------------------------------------------
import * as React from "react";
import type { AgentMessage, AgentStatus, ToolCall } from "#veryfront/agent";
import type { ChatToolPart } from "#veryfront/agent/react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";
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
  /** Compose your own card; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
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

/** Per-card state shared with `AgentCard.*` sub-parts. */
export interface AgentCardContextValue {
  name: string;
  avatarUrl?: string;
  messages?: AgentMessage[];
  toolCalls: ToolCall[];
  status: AgentStatus;
  thinking?: string;
  renderTool?: (toolCall: ToolCall) => React.ReactNode;
  presentation: { color: StatusColor; label: string; pulse: boolean };
}

const AgentCardContext = React.createContext<AgentCardContextValue | null>(
  null,
);

/** Read the enclosing `AgentCard` state. Throws when used outside an `AgentCard`. */
export function useAgentCard(): AgentCardContextValue {
  const ctx = React.useContext(AgentCardContext);
  if (!ctx) {
    throw COMPONENT_ERROR.create({
      detail: "useAgentCard must be used within an AgentCard",
    });
  }
  return ctx;
}

/**
 * `AgentCard.Root` — context provider + the `Card` wrapper. No children renders
 * the default anatomy (`Header` + `Reasoning` + `Tools` + `Body`); pass children
 * to recompose.
 */
const AgentCardRoot = React.forwardRef<HTMLDivElement, AgentCardProps>(
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
      children,
    },
    ref,
  ) {
    const presentation = statusPresentation(status);

    const context: AgentCardContextValue = {
      name,
      avatarUrl,
      messages,
      toolCalls,
      status,
      thinking,
      renderTool,
      presentation,
    };

    return (
      <AgentCardContext.Provider value={context}>
        <Card
          ref={ref}
          surface="outline"
          padding="md"
          className={cn("flex flex-col gap-3", className)}
        >
          {children ?? (
            <>
              <AgentCardHeader />
              <AgentCardReasoning />
              <AgentCardTools />
              <AgentCardBody />
            </>
          )}
        </Card>
      </AgentCardContext.Provider>
    );
  },
);
AgentCardRoot.displayName = "AgentCard.Root";

/**
 * The header row: Avatar + name (left), Status (right). Mirrors
 * `ChatMessageHeader` / `Message.Header`.
 */
function AgentCardHeader(
  { className }: { className?: string },
): React.JSX.Element {
  const { name, avatarUrl, presentation } = useAgentCard();
  return (
    <div className={cn("flex items-center gap-2", className)}>
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
  );
}
AgentCardHeader.displayName = "AgentCard.Header";

/** The reasoning block. Renders only when `thinking` text is present. */
function AgentCardReasoning(
  { className }: { className?: string },
): React.JSX.Element | null {
  const { thinking } = useAgentCard();
  if (!thinking) return null;
  return <ReasoningCard text={thinking} className={className} />;
}
AgentCardReasoning.displayName = "AgentCard.Reasoning";

/** The tool-call list. Renders one `ToolCall` card per entry, or `renderTool`. */
function AgentCardTools(
  { className }: { className?: string },
): React.JSX.Element | null {
  const { toolCalls, renderTool } = useAgentCard();
  if (toolCalls.length === 0) return null;
  return (
    <div className={cn("flex flex-col", className)}>
      {toolCalls.map((tool) => (
        <React.Fragment key={tool.id}>
          {renderTool ? renderTool(tool) : <ToolCallCard tool={toToolPart(tool)} />}
        </React.Fragment>
      ))}
    </div>
  );
}
AgentCardTools.displayName = "AgentCard.Tools";

/** The message body — each message's text rendered as `Markdown`. */
function AgentCardBody(
  { className }: { className?: string },
): React.JSX.Element | null {
  const { messages } = useAgentCard();
  if (!messages || messages.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
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
  );
}
AgentCardBody.displayName = "AgentCard.Body";

/**
 * AgentCard — render `<AgentCard {...props} />` for the default card, or compose
 * `AgentCard.Header` / `Reasoning` / `Tools` / `Body` for a custom layout.
 * Mirrors the `ToolCall` compound: render it, or compose it.
 */
export const AgentCard = Object.assign(AgentCardRoot, {
  Root: AgentCardRoot,
  Header: AgentCardHeader,
  Reasoning: AgentCardReasoning,
  Tools: AgentCardTools,
  Body: AgentCardBody,
});
