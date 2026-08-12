/**
 * Tool UI Components
 * @module react/components/chat/components/tool-ui
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "../../../ui/icons/index.ts";
import { Alert, AlertContent, AlertIcon } from "../../../ui/alert.tsx";
import { Status } from "../../../ui/status.tsx";
import { createStrictContext } from "../../../create-strict-context.ts";
import type { ChatDynamicToolPart, ChatToolPart } from "#veryfront/agent/react";
import { type ChatJsonValue, toChatJsonValue } from "#veryfront/chat/json-value.ts";
import { escapeHtml } from "#veryfront/utils/html-escape.ts";
import { isSkillToolPart } from "../utils/message-parts.ts";
import { getSkillToolProps, SkillTool } from "./skill-tool.tsx";
import { useMessageContextOptional } from "../contexts/message-context.tsx";
import {
  getInvokeAgentStreamEvents,
  INVOKE_AGENT_STREAM_EVENT_NAME,
} from "#veryfront/chat/invoke-agent-stream.ts";
import { ChatMarkdown } from "../../chat-markdown.tsx";

const TOOL_VALUE_LIMITS = Object.freeze({
  maxContainerEntries: 500,
  maxDepth: 12,
  maxNodes: 2_000,
  maxStringChars: 64 * 1024,
});

/** Tool status configuration mapping state to label and icon */
const TOOL_STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode }
> = {
  "input-streaming": {
    label: "Pending",
    icon: <CircleIcon className="size-3.5" />,
  },
  "input-available": {
    label: "Running",
    icon: <ClockIcon className="size-3.5 animate-pulse" />,
  },
  "approval-requested": {
    label: "Awaiting Approval",
    icon: <ClockIcon className="size-3.5 text-yellow-600" />,
  },
  "approval-responded": {
    label: "Responded",
    icon: <CheckCircleIcon className="size-3.5 text-blue-600" />,
  },
  "output-available": {
    label: "Completed",
    icon: <CheckCircleIcon className="size-3.5 text-green-600" />,
  },
  "output-error": {
    label: "Error",
    icon: <XCircleIcon className="size-3.5 text-red-600" />,
  },
  "output-denied": {
    label: "Denied",
    icon: <XCircleIcon className="size-3.5 text-orange-600" />,
  },
  // Legacy states
  call: {
    label: "Running",
    icon: <ClockIcon className="size-3.5 animate-pulse" />,
  },
  "partial-call": {
    label: "Running",
    icon: <ClockIcon className="size-3.5 animate-pulse" />,
  },
  result: {
    label: "Completed",
    icon: <CheckCircleIcon className="size-3.5 text-green-600" />,
  },
  error: {
    label: "Error",
    icon: <XCircleIcon className="size-3.5 text-red-600" />,
  },
};

/** Render tool status badge. */
export function ToolStatusBadge(
  { state, className }: { state: string; className?: string },
): React.JSX.Element {
  const config = TOOL_STATUS_CONFIG[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--outline-border)] px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--foreground)]",
        className,
      )}
    >
      {config?.icon ?? <CircleIcon className="size-3.5" />}
      {config?.label ?? state}
    </span>
  );
}

/**
 * Format JSON with syntax highlighting
 * Note: Escapes HTML first to prevent XSS, then applies safe highlighting
 */
function formatJsonSnapshotWithHighlight(
  snapshot: ChatJsonValue,
): React.ReactNode {
  const jsonStr = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot, null, 2);

  // SECURITY: Escape HTML first to prevent XSS attacks
  const escaped = escapeHtml(jsonStr);

  // After escapeHtml, `"` → `&quot;`, `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`.
  // The inner character class allows any escaped entity except `&quot;` itself
  // (which signals the string boundary), so keys/values containing `&`, `<`, `>`
  // are matched correctly. Without this, `[^&]*` would stop at the first `&amp;`
  // inside a key or value and the span would be omitted.
  const ESCAPED_STRING_INNER = "(?:[^&]|&(?:amp|lt|gt|apos|#\\d+);)*";
  const highlighted = escaped
    .replace(
      new RegExp(`&quot;(${ESCAPED_STRING_INNER})&quot;:`, "g"),
      '<span class="text-green-600">&quot;$1&quot;</span>:',
    )
    .replace(
      new RegExp(`: &quot;(${ESCAPED_STRING_INNER})&quot;`, "g"),
      ': <span class="text-amber-600">&quot;$1&quot;</span>',
    )
    // Match integers, floats, and scientific notation; also values inside arrays.
    .replace(/: (-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, ': <span class="text-blue-600">$1</span>')
    .replace(/: (true|false)\b/g, ': <span class="text-purple-600">$1</span>');

  return (
    <pre
      className="whitespace-pre-wrap font-mono text-sm"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

function formatJsonWithHighlight(obj: unknown): React.ReactNode {
  if (obj == null) return null;
  return formatJsonSnapshotWithHighlight(
    toChatJsonValue(obj, TOOL_VALUE_LIMITS),
  );
}

function renderOutputAsTable(output: ChatJsonValue): React.ReactNode | null {
  if (!Array.isArray(output) || output.length === 0) return null;

  const firstItem = output[0];
  if (typeof firstItem !== "object" || firstItem == null) return null;

  const keys = Object.keys(firstItem);
  if (keys.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--edge)]">
            {keys.map((key) => (
              <th
                key={key}
                className="px-4 py-2 text-left font-medium text-[var(--foreground)]"
              >
                {key.replace(/_/g, " ").replace(
                  /\b\w/g,
                  (c) => c.toUpperCase(),
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {output.map((row, i) => {
            const record = row as Record<string, unknown> | null;

            return (
              <tr key={i} className="border-b border-[var(--edge)]">
                {keys.map((key) => (
                  <td
                    key={key}
                    className="px-4 py-2 text-[var(--foreground)]"
                  >
                    {String(record?.[key] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function hasVisibleToolOutput(output: unknown): boolean {
  return output !== undefined && output !== null;
}

/**
 * Tool call card component - renders tool invocations with parameters and results
 * Styled to match AI Elements (https://ai-sdk.dev/elements)
 *
 * Skill tools (`load_skill`, `load_skill_reference`, `execute_skill_script`)
 * are a compact single-line variant of a tool call, so they render as the
 * `SkillTool` row rather than the full params/result card. This keeps skills
 * and tools under one component — callers render `<ToolCall tool={part} />` for
 * either.
 */
// ---------------------------------------------------------------------------
// ToolCall — compound, render-or-compose (mirrors `Message`).
//
// `<ToolCall tool={part} />` renders the default card (trigger + collapsible
// params / result / error). Pass children to recompose from `ToolCall.Trigger`,
// `ToolCall.Body`, `ToolCall.Input`, `ToolCall.Output`, `ToolCall.Error` — each
// reads `useToolCall()`. `Input`/`Output` take children to swap the rendered
// value; every part takes `className`. Skill tools (or `variant="compact"`)
// render the single-line row by default and accept children to replace it.
// ---------------------------------------------------------------------------

/** Per-tool state shared with `ToolCall.*` sub-parts. */
export interface ToolCallContextValue {
  /** The tool part being rendered (its name, state, input, output, error). */
  tool: ChatToolPart | ChatDynamicToolPart;
  /** Whether the collapsible body is currently open. */
  isExpanded: boolean;
  /** Toggle the expanded state; fires the `onToggle` prop with the next state. */
  toggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Whether the tool produced a non-nullish `output`. */
  hasOutput: boolean;
  /** Whether the tool carries `errorText`. */
  hasError: boolean;
}

const [ToolCallContext, useToolCallContext] = createStrictContext<ToolCallContextValue>(
  "useToolCall",
  "a ToolCall",
);

/**
 * Read the current `ToolCall`'s state from a `ToolCall.*` sub-part.
 * Throws when called outside a `ToolCall` / `ToolCall.Root`.
 *
 * @example
 * ```tsx
 * function ExpandLabel() {
 *   const { isExpanded, toggle } = useToolCall();
 *   return <button onClick={toggle}>{isExpanded ? "Hide" : "Show"}</button>;
 * }
 * // <ToolCall.Root tool={part}><ExpandLabel /></ToolCall.Root>
 * ```
 */
export const useToolCall = useToolCallContext;

type JsonRecord = Record<string, ChatJsonValue>;

function jsonRecord(value: unknown): JsonRecord | undefined {
  const json = toChatJsonValue(value, TOOL_VALUE_LIMITS);
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? json as JsonRecord
    : undefined;
}

function stringValue(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isInvokeAgentTool(tool: ChatToolPart | ChatDynamicToolPart): boolean {
  return tool.toolName === "invoke_agent";
}

function isToolRunning(tool: ChatToolPart | ChatDynamicToolPart): boolean {
  return tool.state === "input-streaming" || tool.state === "input-available" ||
    tool.state === "output-streaming";
}

type InvokeAgentChildTool = ChatDynamicToolPart & { inputText?: string };

interface InvokeAgentStreamView {
  reasoning: string;
  reasoningActive: boolean;
  items: Array<
    | { type: "text"; text: string }
    | { type: "tool"; toolCallId: string }
  >;
  tools: Map<string, InvokeAgentChildTool>;
}

function childEventString(event: Record<string, unknown>, key: string): string {
  const value = event[key];
  return typeof value === "string" ? value : "";
}

function reduceInvokeAgentStream(
  events: Array<Record<string, unknown> & { type: string }>,
): InvokeAgentStreamView {
  const view: InvokeAgentStreamView = {
    reasoning: "",
    reasoningActive: false,
    items: [],
    tools: new Map(),
  };

  function appendText(text: string): void {
    if (!text) return;
    const lastItem = view.items.at(-1);
    if (lastItem?.type === "text") {
      lastItem.text += text;
      return;
    }
    view.items.push({ type: "text", text });
  }

  function addTool(toolCallId: string): void {
    if (!view.items.some((item) => item.type === "tool" && item.toolCallId === toolCallId)) {
      view.items.push({ type: "tool", toolCallId });
    }
  }

  for (const event of events) {
    if (event.type === "reasoning-start") {
      view.reasoningActive = true;
      continue;
    }
    if (event.type === "reasoning-delta") {
      view.reasoningActive = true;
      view.reasoning += childEventString(event, "delta");
      continue;
    }
    if (event.type === "reasoning-end") {
      view.reasoningActive = false;
      continue;
    }
    if (event.type === "text-delta") {
      appendText(childEventString(event, "delta"));
      continue;
    }

    const toolCallId = childEventString(event, "toolCallId");
    if (!toolCallId) continue;
    const existing = view.tools.get(toolCallId);
    if (event.type === "tool-input-start") {
      addTool(toolCallId);
      view.tools.set(toolCallId, {
        type: "dynamic-tool",
        toolCallId,
        toolName: childEventString(event, "toolName") || "tool",
        state: "input-streaming",
        input: {},
        inputText: "",
      });
      continue;
    }
    if (event.type === "tool-input-delta" && existing) {
      existing.inputText = `${existing.inputText ?? ""}${
        childEventString(event, "inputTextDelta")
      }`;
      continue;
    }
    if (event.type === "tool-input-available") {
      addTool(toolCallId);
      view.tools.set(toolCallId, {
        type: "dynamic-tool",
        toolCallId,
        toolName: childEventString(event, "toolName") || existing?.toolName || "tool",
        state: "input-available",
        input: Object.hasOwn(event, "input") ? event.input : existing?.input ?? {},
      });
      continue;
    }
    if (event.type === "tool-output-available") {
      addTool(toolCallId);
      view.tools.set(toolCallId, {
        type: "dynamic-tool",
        toolCallId,
        toolName: existing?.toolName ?? "tool",
        state: "output-available",
        input: existing?.input ?? {},
        output: Object.hasOwn(event, "output") ? event.output : null,
      });
      continue;
    }
    if (event.type === "tool-output-error" || event.type === "tool-input-error") {
      addTool(toolCallId);
      view.tools.set(toolCallId, {
        type: "dynamic-tool",
        toolCallId,
        toolName: existing?.toolName ?? "tool",
        state: "output-error",
        input: existing?.input ?? {},
        errorText: childEventString(event, "errorText") || childEventString(event, "error") ||
          "Tool execution failed",
      });
    }
  }

  return view;
}

function useInvokeAgentStreamView(toolCallId: string): InvokeAgentStreamView {
  const message = useMessageContextOptional()?.message;
  return React.useMemo(() => {
    const events = (message?.parts ?? []).flatMap((part) => {
      if (part.type !== `data-${INVOKE_AGENT_STREAM_EVENT_NAME}`) return [];
      if (!part.data || typeof part.data !== "object") return [];
      return (part.data as Record<string, unknown>).toolCallId === toolCallId
        ? getInvokeAgentStreamEvents(part.data)
        : [];
    });
    return reduceInvokeAgentStream(events);
  }, [message?.parts, toolCallId]);
}

/** Studio-style child-agent card used by the automatic `invoke_agent` renderer. */
function InvokeAgentToolCall(
  { className, icon, ref }: Pick<ToolCallProps, "className" | "icon" | "ref">,
): React.ReactElement {
  const { tool, isExpanded, toggle } = useToolCall();
  const childStream = useInvokeAgentStreamView(tool.toolCallId);
  const input = jsonRecord(tool.input);
  const rawOutput = jsonRecord(tool.output);
  const output = jsonRecord(rawOutput?.structuredContent) ?? rawOutput;
  const status = stringValue(output, "status")?.toLowerCase();
  const failed = tool.state === "output-error" || status === "failed" || status === "error" ||
    output?.ok === false;
  const stopped = status === "cancelled" || status === "canceled" || status === "stopped";
  const completed = tool.state === "output-available" || status === "completed" ||
    output?.ok === true;
  const statusProps = failed
    ? { label: "Failed", color: "red" as const }
    : stopped
    ? { label: "Stopped", color: "gray" as const }
    : completed
    ? { label: "Completed", color: "green" as const }
    : { label: "Running", color: "blue" as const, pulse: true };
  const agentId = stringValue(input, "agent_id") ?? stringValue(output, "agentId");
  const title = agentId
    ? agentId.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Child agent";
  const summary = jsonRecord(output?.summary);
  const result = tool.errorText ?? stringValue(output, "text") ?? stringValue(output, "error") ??
    stringValue(output, "terminalErrorMessage") ?? stringValue(summary, "text");
  const fallbackResponse = failed
    ? (result ?? "The child agent run failed before returning a usable result.")
    : result;
  const instructions = stringValue(input, "prompt") ?? stringValue(input, "description");
  const hasStreamedText = childStream.items.some((item) => item.type === "text");
  const response = hasStreamedText && !failed ? undefined : fallbackResponse;
  const phase = completed || failed || stopped
    ? "result"
    : childStream.items.length > 0
    ? "working"
    : childStream.reasoning
    ? "reasoning"
    : "instructions";
  const [instructionsOpen, setInstructionsOpen] = React.useState(phase === "instructions");
  const [reasoningOpen, setReasoningOpen] = React.useState(
    phase === "reasoning" && childStream.reasoningActive,
  );
  const previousPhaseRef = React.useRef(phase);
  if (previousPhaseRef.current !== phase) {
    previousPhaseRef.current = phase;
    setInstructionsOpen(phase === "instructions");
  }
  const previousReasoningActiveRef = React.useRef(childStream.reasoningActive);
  if (previousReasoningActiveRef.current !== childStream.reasoningActive) {
    previousReasoningActiveRef.current = childStream.reasoningActive;
    setReasoningOpen(phase === "reasoning" && childStream.reasoningActive);
  }
  const showBody = isExpanded && Boolean(
    instructions || childStream.reasoning || response || childStream.items.length,
  );

  return (
    <div
      ref={ref}
      className={cn(
        "not-prose w-full rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent p-4",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="mt-0 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-sm font-medium text-[var(--foreground)]">
            {icon ?? title.charAt(0)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">
            {title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Status {...statusProps} />
          <ChevronDownIcon
            className={cn(
              "size-3.5 text-[var(--faint)] transition-transform",
              isExpanded ? "rotate-180" : "-rotate-90",
            )}
          />
        </span>
      </button>
      {showBody && (
        <div className="mt-3 space-y-3 border-t border-[var(--edge)] pt-3">
          {instructions && (
            <details
              className="group/instructions"
              open={instructionsOpen}
              onToggle={(event) => setInstructionsOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-medium text-[var(--soft)]">
                Instructions
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">
                {instructions}
              </p>
            </details>
          )}
          {childStream.reasoning && (
            <details
              className="group/reasoning"
              open={reasoningOpen}
              onToggle={(event) => setReasoningOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-medium text-[var(--soft)]">
                Thought process
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--soft)]">
                {childStream.reasoning}
              </p>
            </details>
          )}
          {childStream.items.map((item, index) => {
            if (item.type === "text") {
              return (
                <ChatMarkdown
                  key={`text-${index}`}
                  className="text-sm leading-6 text-[var(--foreground)]"
                >
                  {item.text}
                </ChatMarkdown>
              );
            }
            const childTool = childStream.tools.get(item.toolCallId);
            return childTool ? <ToolCallRoot key={childTool.toolCallId} tool={childTool} /> : null;
          })}
          {response && (
            <ChatMarkdown className="text-sm leading-6 text-[var(--foreground)]">
              {response}
            </ChatMarkdown>
          )}
        </div>
      )}
    </div>
  );
}

/** Props accepted by `ToolCall` / `ToolCall.Root`. */
export interface ToolCallProps {
  /** The tool part to render (invocation name, state, input, output, error). */
  tool: ChatToolPart | ChatDynamicToolPart;
  className?: string;
  /** Override the leading tool icon (card variant). */
  icon?: React.ReactNode;
  /**
   * `card` (full params/result) or `compact` (single-line row). Defaults to
   * `compact` for skill tools, `card` otherwise. This is a presentation axis —
   * NOT a severity/type.
   */
  variant?: "card" | "compact";
  /** Initial expanded state of the card (default: auto from tool state). */
  defaultExpanded?: boolean;
  /** Called when the card is toggled; receives the next state + event. */
  onToggle?: (next: boolean, e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Compose your own card or replace the compact row. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * `ToolCall.Root` — context provider + the card wrapper. No children renders
 * the default anatomy (`Trigger` + `Body`); pass children to recompose. Skill /
 * compact tools render a single-line row by default and accept replacement children.
 */
function ToolCallRoot(
  { tool, className, icon, variant, defaultExpanded, onToggle, children, ref }: ToolCallProps,
): React.ReactElement {
  const hasOutput = hasVisibleToolOutput(tool.output);
  const hasError = Boolean(tool.errorText);
  const usesDefaultInvokeRenderer = variant === undefined && children === undefined &&
    isInvokeAgentTool(tool);
  // Collapse tool cards by default. Fast server-side tools (e.g.
  // `search_knowledge`) resolve near-instantly and otherwise stack up
  // expanded, burying the assistant's actual reply. The trigger row still
  // shows the tool name + status badge, and the chevron expands on demand.
  // Errors stay open so failures aren't hidden behind a click.
  const shouldExpandByDefault = hasError || (usesDefaultInvokeRenderer && isToolRunning(tool));
  const [isExpanded, setIsExpanded] = React.useState(
    defaultExpanded ?? shouldExpandByDefault,
  );
  const previousAutoExpandRef = React.useRef(shouldExpandByDefault);
  if (
    defaultExpanded === undefined &&
    previousAutoExpandRef.current !== shouldExpandByDefault
  ) {
    previousAutoExpandRef.current = shouldExpandByDefault;
    setIsExpanded(shouldExpandByDefault);
  }

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = !isExpanded;
    setIsExpanded(next);
    onToggle?.(next, e);
  };

  const context: ToolCallContextValue = {
    tool,
    isExpanded,
    toggle,
    hasOutput,
    hasError,
  };

  if (usesDefaultInvokeRenderer) {
    return (
      <ToolCallContext.Provider value={context}>
        <InvokeAgentToolCall className={className} icon={icon} ref={ref} />
      </ToolCallContext.Provider>
    );
  }

  // Compact row for skill tools (or when forced), a presentation variant.
  const isCompact = variant === "compact" ||
    (variant !== "card" && isSkillToolPart(tool));
  if (isCompact) {
    return (
      <ToolCallContext.Provider value={context}>
        {children ?? <SkillTool {...getSkillToolProps(tool)} />}
      </ToolCallContext.Provider>
    );
  }

  return (
    <ToolCallContext.Provider value={context}>
      <div
        ref={ref}
        className={cn(
          "not-prose w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent px-4 py-2.5",
          className,
        )}
      >
        {children ?? (
          <>
            <ToolCallTrigger icon={icon} />
            <ToolCallBody />
          </>
        )}
      </div>
    </ToolCallContext.Provider>
  );
}
ToolCallRoot.displayName = "ToolCall.Root";

/** Props for `ToolCall.Trigger` — the header button. */
export interface ToolCallTriggerProps {
  /** Replace the default glyph. The canonical path (RFC 2980: a leaf renders its
   * default icon when childless; pass children to replace it). */
  children?: React.ReactNode;
  /** @deprecated Pass `children` instead. Kept working for backward compatibility. */
  icon?: React.ReactNode;
  className?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The header row: tool icon + name + status badge + expand chevron. */
function ToolCallTrigger(
  { children, icon, className, ref }: ToolCallTriggerProps,
): React.JSX.Element {
  const { tool, isExpanded, toggle } = useToolCall();
  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      className={cn(
        "group flex w-full items-center justify-between gap-3 text-left transition-colors hover:text-[var(--foreground)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {children ?? icon ?? <WrenchIcon className="size-3.5 shrink-0 text-[var(--foreground)]" />}
        <span className="min-w-0 truncate text-sm font-medium leading-tight text-[var(--foreground)]">
          {tool.toolName}
        </span>
        <ToolStatusBadge state={tool.state} />
      </div>
      <ChevronDownIcon
        className={cn(
          "size-3.5 shrink-0 text-[var(--faint)] transition-transform",
          isExpanded && "rotate-180",
        )}
      />
    </button>
  );
}
ToolCallTrigger.displayName = "ToolCall.Trigger";

/** The collapsible region below the trigger. Renders only when expanded. */
function ToolCallBody(
  { className, children, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element | null {
  const { isExpanded } = useToolCall();
  if (!isExpanded) return null;
  return (
    <div {...props} ref={ref} className={cn("mt-3 border-t border-[var(--edge)] pt-3", className)}>
      {children ?? (
        <>
          <ToolCallInput />
          <ToolCallOutput />
          <ToolCallError />
        </>
      )}
    </div>
  );
}
ToolCallBody.displayName = "ToolCall.Body";

/** The `Parameters` block. Pass children to replace the highlighted JSON. */
function ToolCallInput(
  { className, children, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element | null {
  const { tool } = useToolCall();
  if (tool.input === undefined) return null;
  return (
    <div {...props} ref={ref} className={cn("space-y-2 overflow-hidden", className)}>
      <h4 className="text-xs font-medium text-[var(--faint)]">
        Parameters
      </h4>
      <div className="rounded-[var(--radius-md)] bg-[var(--secondary)] p-3">
        {children ?? formatJsonWithHighlight(tool.input)}
      </div>
    </div>
  );
}
ToolCallInput.displayName = "ToolCall.Input";

/** The `Result` block. Pass children to replace the JSON / auto-table output. */
function ToolCallOutput(
  { className, children, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element | null {
  const { tool, hasOutput } = useToolCall();
  if (!hasOutput) return null;
  const output = toChatJsonValue(tool.output, TOOL_VALUE_LIMITS);
  const tableOutput = renderOutputAsTable(output);
  return (
    <div
      {...props}
      ref={ref}
      className={cn(
        "mt-3 space-y-2 border-t border-[var(--edge)] pt-3",
        className,
      )}
    >
      <h4 className="text-xs font-medium text-[var(--faint)]">
        Result
      </h4>
      <div className="overflow-x-auto rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--foreground)]">
        {children ?? tableOutput ?? (
          <div className="p-3">
            {formatJsonSnapshotWithHighlight(output)}
          </div>
        )}
      </div>
    </div>
  );
}
ToolCallOutput.displayName = "ToolCall.Output";

/** The error `Alert`. Renders only when the tool carries `errorText`. */
function ToolCallError(
  { className, ref, ...props }:
    & Omit<React.HTMLAttributes<HTMLDivElement>, "children">
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element | null {
  const { tool } = useToolCall();
  if (!tool.errorText) return null;
  return (
    <div {...props} ref={ref} className={cn("mt-3 border-t border-[var(--edge)] pt-3", className)}>
      <Alert variant="error">
        <AlertIcon>
          <XCircleIcon className="size-4" />
        </AlertIcon>
        <AlertContent>{tool.errorText}</AlertContent>
      </Alert>
    </div>
  );
}
ToolCallError.displayName = "ToolCall.Error";

/**
 * ToolCall — render `<ToolCall tool={part} />` for the default card. `invoke_agent`
 * calls use a child-agent card by default. Pass children to replace the default,
 * or compose `ToolCall.Trigger` / `Body` / `Input` / `Output` / `Error` for a
 * custom layout. Mirrors the `Message` compound: render it, or compose it.
 */
export const ToolCall = Object.assign(ToolCallRoot, {
  Root: ToolCallRoot,
  Trigger: ToolCallTrigger,
  Body: ToolCallBody,
  Input: ToolCallInput,
  Output: ToolCallOutput,
  Error: ToolCallError,
});
