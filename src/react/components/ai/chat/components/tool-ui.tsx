/**
 * Tool UI Components
 * @module ai/react/components/chat/components/tool-ui
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
import type { DynamicToolUIPart, ToolUIPart } from "#veryfront/agent/react";
import { escapeHtml } from "#veryfront/utils/html-escape.ts";

/** Tool status configuration mapping state to label and icon */
const TOOL_STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  "input-streaming": { label: "Pending", icon: <CircleIcon className="size-3.5" /> },
  "input-available": { label: "Running", icon: <ClockIcon className="size-3.5 animate-pulse" /> },
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
  "output-error": { label: "Error", icon: <XCircleIcon className="size-3.5 text-red-600" /> },
  "output-denied": { label: "Denied", icon: <XCircleIcon className="size-3.5 text-orange-600" /> },
  // Legacy states
  call: { label: "Running", icon: <ClockIcon className="size-3.5 animate-pulse" /> },
  "partial-call": { label: "Running", icon: <ClockIcon className="size-3.5 animate-pulse" /> },
  result: { label: "Completed", icon: <CheckCircleIcon className="size-3.5 text-green-600" /> },
  error: { label: "Error", icon: <XCircleIcon className="size-3.5 text-red-600" /> },
};

export function ToolStatusBadge({ state }: { state: string }): React.JSX.Element {
  const config = TOOL_STATUS_CONFIG[state];

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground border border-border">
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
      className="text-sm font-mono whitespace-pre-wrap"
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
          <tr className="border-b border-[var(--border)]">
            {keys.map((key) => (
              <th
                key={key}
                className="px-4 py-2 text-left font-semibold text-[var(--foreground)]"
              >
                {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {output.map((row, i) => {
            const record = row as Record<string, unknown> | null;

            return (
              <tr key={i} className="border-b border-[var(--border)]">
                {keys.map((key) => (
                  <td key={key} className="px-4 py-2 text-[var(--card-foreground)]">
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

/**
 * Tool call card component - renders tool invocations with parameters and results
 * Styled to match AI Elements (https://ai-sdk.dev/elements)
 */
export function ToolCallCard({
  tool,
}: {
  tool: ToolUIPart | DynamicToolUIPart;
}): React.JSX.Element {
  const [isExpanded, setIsExpanded] = React.useState(true);

  const tableOutput = tool.output === undefined ? null : renderOutputAsTable(tool.output);

  return (
    <div className="not-prose w-full rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="group flex w-full items-center justify-between gap-4 p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <WrenchIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm text-foreground">{tool.toolName}</span>
          <ToolStatusBadge state={tool.state} />
        </div>
        <ChevronDownIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      {!isExpanded ? null : (
        <div className="border-t border-border">
          {tool.input === undefined ? null : (
            <div className="space-y-2 overflow-hidden p-4">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Parameters
              </h4>
              <div className="rounded-md bg-muted/50 p-3">
                {formatJsonWithHighlight(tool.input)}
              </div>
            </div>
          )}

          {tool.output === undefined ? null : (
            <div className="space-y-2 p-4 border-t border-border">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Result
              </h4>
              <div className="overflow-x-auto rounded-md bg-muted/50 text-foreground">
                {tableOutput ?? <div className="p-3">{formatJsonWithHighlight(tool.output)}</div>}
              </div>
            </div>
          )}

          {!tool.errorText ? null : (
            <div className="space-y-2 p-4 border-t border-border">
              <h4 className="font-medium text-destructive text-xs uppercase tracking-wide">
                Error
              </h4>
              <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">
                {tool.errorText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
