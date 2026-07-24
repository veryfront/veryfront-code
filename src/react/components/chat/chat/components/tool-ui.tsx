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
import { createStrictContext } from "../../../create-strict-context.ts";
import type { ChatDynamicToolPart, ChatToolPart } from "#veryfront/agent/react";
import { escapeHtml } from "#veryfront/utils/html-escape.ts";
import { isSkillToolPart } from "../utils/message-parts.ts";
import { getSkillToolProps, SkillTool } from "./skill-tool.tsx";

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
function formatJsonWithHighlight(obj: unknown): React.ReactNode {
  if (obj == null) return null;

  const jsonStr = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);

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

function renderOutputAsTable(output: unknown): React.ReactNode | null {
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
  tool: ChatToolPart | ChatDynamicToolPart;
  isExpanded: boolean;
  toggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  hasOutput: boolean;
  hasError: boolean;
}

const [ToolCallContext, useToolCall] = createStrictContext<ToolCallContextValue>(
  "useToolCall",
  "a ToolCall",
);
export { useToolCall };

/** Props accepted by `ToolCall` / `ToolCall.Root`. */
export interface ToolCallProps {
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
  // Collapse tool cards by default. Fast server-side tools (e.g.
  // `search_knowledge`) resolve near-instantly and otherwise stack up
  // expanded, burying the assistant's actual reply. The trigger row still
  // shows the tool name + status badge, and the chevron expands on demand.
  // Errors stay open so failures aren't hidden behind a click.
  const shouldExpandByDefault = hasError;
  const [isExpanded, setIsExpanded] = React.useState(
    defaultExpanded ?? shouldExpandByDefault,
  );

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
  /** Override the leading tool icon. */
  icon?: React.ReactNode;
  className?: string;
}

/** The header row: tool icon + name + status badge + expand chevron. */
function ToolCallTrigger(
  { icon, className }: ToolCallTriggerProps,
): React.JSX.Element {
  const { tool, isExpanded, toggle } = useToolCall();
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "group flex w-full items-center justify-between gap-3 text-left transition-colors hover:text-[var(--foreground)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ?? <WrenchIcon className="size-3.5 shrink-0 text-[var(--foreground)]" />}
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
  { className, children }: { className?: string; children?: React.ReactNode },
): React.JSX.Element | null {
  const { isExpanded } = useToolCall();
  if (!isExpanded) return null;
  return (
    <div className={cn("mt-3 border-t border-[var(--edge)] pt-3", className)}>
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
  { className, children }: { className?: string; children?: React.ReactNode },
): React.JSX.Element | null {
  const { tool } = useToolCall();
  if (tool.input === undefined) return null;
  return (
    <div className={cn("space-y-2 overflow-hidden", className)}>
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
  { className, children }: { className?: string; children?: React.ReactNode },
): React.JSX.Element | null {
  const { tool, hasOutput } = useToolCall();
  if (!hasOutput) return null;
  const tableOutput = renderOutputAsTable(tool.output);
  return (
    <div
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
            {formatJsonWithHighlight(tool.output)}
          </div>
        )}
      </div>
    </div>
  );
}
ToolCallOutput.displayName = "ToolCall.Output";

/** The error `Alert`. Renders only when the tool carries `errorText`. */
function ToolCallError(
  { className }: { className?: string },
): React.JSX.Element | null {
  const { tool } = useToolCall();
  if (!tool.errorText) return null;
  return (
    <div className={cn("mt-3 border-t border-[var(--edge)] pt-3", className)}>
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
 * ToolCall — render `<ToolCall tool={part} />` for the default card, or compose
 * `ToolCall.Trigger` / `Body` / `Input` / `Output` / `Error` for a custom
 * layout. Mirrors the `Message` compound: render it, or compose it.
 */
export const ToolCall = Object.assign(ToolCallRoot, {
  Root: ToolCallRoot,
  Trigger: ToolCallTrigger,
  Body: ToolCallBody,
  Input: ToolCallInput,
  Output: ToolCallOutput,
  Error: ToolCallError,
});
