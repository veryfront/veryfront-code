/**
 * Tool UI Components
 * @module ai/react/components/chat/components/tool-ui
 */
import * as React from "react";
import { cn } from "../../theme.js";
import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon, } from "../../icons/index.js";
/** Tool status configuration mapping state to label and icon */
const TOOL_STATUS_CONFIG = {
    "input-streaming": { label: "Pending", icon: React.createElement(CircleIcon, { className: "size-3.5" }) },
    "input-available": { label: "Running", icon: React.createElement(ClockIcon, { className: "size-3.5 animate-pulse" }) },
    "approval-requested": {
        label: "Awaiting Approval",
        icon: React.createElement(ClockIcon, { className: "size-3.5 text-yellow-600" }),
    },
    "approval-responded": {
        label: "Responded",
        icon: React.createElement(CheckCircleIcon, { className: "size-3.5 text-blue-600" }),
    },
    "output-available": {
        label: "Completed",
        icon: React.createElement(CheckCircleIcon, { className: "size-3.5 text-green-600" }),
    },
    "output-error": { label: "Error", icon: React.createElement(XCircleIcon, { className: "size-3.5 text-red-600" }) },
    "output-denied": { label: "Denied", icon: React.createElement(XCircleIcon, { className: "size-3.5 text-orange-600" }) },
    // Legacy states
    call: { label: "Running", icon: React.createElement(ClockIcon, { className: "size-3.5 animate-pulse" }) },
    "partial-call": { label: "Running", icon: React.createElement(ClockIcon, { className: "size-3.5 animate-pulse" }) },
    result: { label: "Completed", icon: React.createElement(CheckCircleIcon, { className: "size-3.5 text-green-600" }) },
    error: { label: "Error", icon: React.createElement(XCircleIcon, { className: "size-3.5 text-red-600" }) },
};
/** Tool call status badge component (AI Elements style) */
export function ToolStatusBadge({ state }) {
    const config = TOOL_STATUS_CONFIG[state];
    return (React.createElement("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground border border-border" },
        config?.icon ?? React.createElement(CircleIcon, { className: "size-3.5" }),
        config?.label ?? state));
}
/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
/**
 * Format JSON with syntax highlighting
 * Note: Escapes HTML first to prevent XSS, then applies safe highlighting
 */
function formatJsonWithHighlight(obj) {
    if (obj == null)
        return null;
    const jsonStr = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
    // SECURITY: Escape HTML first to prevent XSS attacks
    const escaped = escapeHtml(jsonStr);
    const highlighted = escaped
        .replace(/&quot;([^&]*)&quot;:/g, '<span class="text-green-600 dark:text-green-400">&quot;$1&quot;</span>:')
        .replace(/: &quot;([^&]*)&quot;/g, ': <span class="text-amber-600 dark:text-amber-400">&quot;$1&quot;</span>')
        .replace(/: (\d+)/g, ': <span class="text-blue-600 dark:text-blue-400">$1</span>')
        .replace(/: (true|false)/g, ': <span class="text-purple-600 dark:text-purple-400">$1</span>');
    return (React.createElement("pre", { className: "text-sm font-mono whitespace-pre-wrap", dangerouslySetInnerHTML: { __html: highlighted } }));
}
/**
 * Render output as table if it's an array of objects
 */
function renderOutputAsTable(output) {
    if (!Array.isArray(output) || output.length === 0)
        return null;
    const firstItem = output[0];
    if (typeof firstItem !== "object" || firstItem == null)
        return null;
    const keys = Object.keys(firstItem);
    if (keys.length === 0)
        return null;
    return (React.createElement("div", { className: "overflow-x-auto" },
        React.createElement("table", { className: "min-w-full text-sm" },
            React.createElement("thead", null,
                React.createElement("tr", { className: "border-b border-neutral-200 dark:border-neutral-700" }, keys.map((key) => (React.createElement("th", { key: key, className: "px-4 py-2 text-left font-semibold text-neutral-900 dark:text-neutral-100" }, key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())))))),
            React.createElement("tbody", null, output.map((row, i) => (React.createElement("tr", { key: i, className: "border-b border-neutral-100 dark:border-neutral-800" }, keys.map((key) => (React.createElement("td", { key: key, className: "px-4 py-2 text-neutral-700 dark:text-neutral-300" }, String(row?.[key] ?? "")))))))))));
}
/**
 * Tool call card component - renders tool invocations with parameters and results
 * Styled to match AI Elements (https://ai-sdk.dev/elements)
 */
export function ToolCallCard({ tool, }) {
    const [isExpanded, setIsExpanded] = React.useState(true);
    const tableOutput = tool.output !== undefined ? renderOutputAsTable(tool.output) : null;
    return (React.createElement("div", { className: "not-prose w-full rounded-md border border-border bg-card" },
        React.createElement("button", { type: "button", onClick: () => setIsExpanded((v) => !v), className: "group flex w-full items-center justify-between gap-4 p-3 hover:bg-muted/50 transition-colors" },
            React.createElement("div", { className: "flex items-center gap-2" },
                React.createElement(WrenchIcon, { className: "size-4 text-muted-foreground" }),
                React.createElement("span", { className: "font-medium text-sm text-foreground" }, tool.toolName),
                React.createElement(ToolStatusBadge, { state: tool.state })),
            React.createElement(ChevronDownIcon, { className: cn("size-4 text-muted-foreground transition-transform", isExpanded && "rotate-180") })),
        isExpanded && (React.createElement("div", { className: "border-t border-border" },
            tool.input !== undefined && (React.createElement("div", { className: "space-y-2 overflow-hidden p-4" },
                React.createElement("h4", { className: "font-medium text-muted-foreground text-xs uppercase tracking-wide" }, "Parameters"),
                React.createElement("div", { className: "rounded-md bg-muted/50 p-3" }, formatJsonWithHighlight(tool.input)))),
            tool.output !== undefined && (React.createElement("div", { className: "space-y-2 p-4 border-t border-border" },
                React.createElement("h4", { className: "font-medium text-muted-foreground text-xs uppercase tracking-wide" }, "Result"),
                React.createElement("div", { className: "overflow-x-auto rounded-md bg-muted/50 text-foreground" }, tableOutput ?? React.createElement("div", { className: "p-3" }, formatJsonWithHighlight(tool.output))))),
            tool.errorText && (React.createElement("div", { className: "space-y-2 p-4 border-t border-border" },
                React.createElement("h4", { className: "font-medium text-destructive text-xs uppercase tracking-wide" }, "Error"),
                React.createElement("div", { className: "rounded-md bg-destructive/10 text-destructive p-3 text-sm" }, tool.errorText)))))));
}
