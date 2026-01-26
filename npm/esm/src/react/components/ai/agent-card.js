import * as React from "react";
import { AgentContainer, AgentStatus as AgentStatusPrimitive, ThinkingIndicator, ToolInvocation, ToolList, ToolResult, } from "../../primitives/index.js";
import { cn, defaultAgentTheme, mergeThemes } from "./theme.js";
export const AgentCard = React.forwardRef(({ messages, toolCalls = [], status, thinking, className, theme: userTheme, renderTool, }, ref) => {
    const theme = mergeThemes(defaultAgentTheme, userTheme);
    const toolRenderer = renderTool ??
        ((tool) => (React.createElement(ToolInvocation, { name: tool.name, args: tool.args, status: tool.status, className: theme.tool },
            tool.result !== undefined && (React.createElement(ToolResult, { result: tool.result, className: theme.toolResult })),
            tool.error && (React.createElement("div", { className: "mt-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100 rounded-xl text-sm border border-red-200 dark:border-red-800" },
                "Error: ",
                tool.error)))));
    return (React.createElement(AgentContainer, { ref: ref, className: cn(theme.container, className) },
        React.createElement(AgentStatusPrimitive, { status: status, className: cn(theme.status, getStatusColor(status)) }),
        thinking && (React.createElement(ThinkingIndicator, { className: theme.thinking },
            React.createElement("span", { className: "font-semibold" }, "Thinking:"),
            thinking)),
        toolCalls.length > 0 && (React.createElement("div", { className: "space-y-3" },
            React.createElement("h3", { className: "text-sm font-semibold text-neutral-700 dark:text-neutral-300" }, "Tool Calls"),
            React.createElement(ToolList, { toolCalls: toolCalls, className: "space-y-3", renderTool: toolRenderer }))),
        messages?.length
            ? (React.createElement("div", { className: "space-y-3" },
                React.createElement("h3", { className: "text-sm font-semibold text-neutral-700 dark:text-neutral-300" }, "Messages"),
                React.createElement("div", { className: "space-y-2 max-h-96 overflow-y-auto" }, messages.map((msg) => (React.createElement("div", { key: msg.id, className: "text-sm p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800" },
                    React.createElement("span", { className: "font-semibold capitalize text-neutral-900 dark:text-neutral-100" },
                        msg.role,
                        ":"),
                    React.createElement("span", { className: "text-neutral-600 dark:text-neutral-400 ml-1" },
                        msg.content.substring(0, 200),
                        "...")))))))
            : null));
});
AgentCard.displayName = "AgentCard";
function getStatusColor(status) {
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
