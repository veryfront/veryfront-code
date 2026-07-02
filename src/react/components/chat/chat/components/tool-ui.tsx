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
} from "../../icons/index.ts";
import { Alert, AlertContent, AlertIcon } from "../../ui/alert.tsx";
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
  { state }: { state: string },
): React.JSX.Element {
  const config = TOOL_STATUS_CONFIG[state];

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--outline-border)] px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--foreground)]">
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

  const highlighted = escaped
    .replace(
      /&quot;([^&]*)&quot;:/g,
      '<span class="text-green-600">&quot;$1&quot;</span>:',
    )
    .replace(
      /: &quot;([^&]*)&quot;/g,
      ': <span class="text-amber-600">&quot;$1&quot;</span>',
    )
    .replace(/: (\d+)/g, ': <span class="text-blue-600">$1</span>')
    .replace(/: (true|false)/g, ': <span class="text-purple-600">$1</span>');

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
export function ToolCallCard({
  tool,
}: {
  tool: ChatToolPart | ChatDynamicToolPart;
}): React.JSX.Element {
  if (isSkillToolPart(tool)) {
    return <SkillTool {...getSkillToolProps(tool)} />;
  }

  const hasOutput = hasVisibleToolOutput(tool.output);
  const hasError = Boolean(tool.errorText);
  const shouldExpandByDefault = tool.state !== "output-available" ||
    hasOutput || hasError;
  const [isExpanded, setIsExpanded] = React.useState(shouldExpandByDefault);
  const tableOutput = hasOutput ? renderOutputAsTable(tool.output) : null;

  return (
    <div className="not-prose mb-2 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent p-4">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="group flex w-full items-center justify-between gap-3 text-left transition-colors hover:text-[var(--foreground)]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <WrenchIcon className="size-3.5 shrink-0 text-[var(--foreground)]" />
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

      {!isExpanded ? null : (
        <div className="mt-3 border-t border-[var(--edge)] pt-3">
          {tool.input === undefined ? null : (
            <div className="space-y-2 overflow-hidden">
              <h4 className="text-xs font-medium text-[var(--faint)]">
                Parameters
              </h4>
              <div className="rounded-[var(--radius-md)] bg-[var(--secondary)] p-3">
                {formatJsonWithHighlight(tool.input)}
              </div>
            </div>
          )}

          {!hasOutput ? null : (
            <div className="mt-3 space-y-2 border-t border-[var(--edge)] pt-3">
              <h4 className="text-xs font-medium text-[var(--faint)]">
                Result
              </h4>
              <div className="overflow-x-auto rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--foreground)]">
                {tableOutput ?? (
                  <div className="p-3">
                    {formatJsonWithHighlight(tool.output)}
                  </div>
                )}
              </div>
            </div>
          )}

          {!tool.errorText ? null : (
            <div className="mt-3 border-t border-[var(--edge)] pt-3">
              <Alert variant="error">
                <AlertIcon>
                  <XCircleIcon className="size-4" />
                </AlertIcon>
                <AlertContent>{tool.errorText}</AlertContent>
              </Alert>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
