import * as React from "react";
export const AgentContainer = React.forwardRef(({ className, children, ...props }, ref) => (React.createElement("div", { ref: ref, className: className, "data-agent-container": "", ...props }, children)));
AgentContainer.displayName = "AgentContainer";
export const AgentStatus = React.forwardRef(({ className, status, label, ...props }, ref) => {
    const displayLabel = label ?? formatStatus(status);
    return (React.createElement("div", { ref: ref, className: className, "data-agent-status": "", "data-status": status, role: "status", "aria-label": `Agent status: ${displayLabel}`, ...props }, displayLabel));
});
AgentStatus.displayName = "AgentStatus";
export const ThinkingIndicator = React.forwardRef(({ className, children, ...props }, ref) => (React.createElement("div", { ref: ref, className: className, "data-thinking-indicator": "", role: "status", "aria-live": "polite", ...props }, children)));
ThinkingIndicator.displayName = "ThinkingIndicator";
function formatStatus(status) {
    switch (status) {
        case "idle":
            return "Idle";
        case "thinking":
            return "Thinking...";
        case "tool_execution":
            return "Using tools...";
        case "streaming":
            return "Responding...";
        case "completed":
            return "Completed";
        case "error":
            return "Error";
        default:
            return String(status);
    }
}
