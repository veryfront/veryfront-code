import * as React from "react";
export const ToolInvocation = React.forwardRef(({ className, name, input, state, errorText, dynamic, children, ...props }, ref) => {
    return (React.createElement("div", { ref: ref, className: className, "data-tool-invocation": "", "data-tool-name": name, "data-state": state, "data-dynamic": dynamic || undefined, ...props },
        React.createElement("div", { "data-tool-header": "" },
            React.createElement("span", { "data-tool-name": "" }, name),
            state && React.createElement("span", { "data-tool-state": "" },
                "(",
                state,
                ")"),
            dynamic && React.createElement("span", { "data-tool-dynamic": "" }, "[dynamic]")),
        input !== undefined && (React.createElement("div", { "data-tool-input": "" },
            React.createElement("pre", null, JSON.stringify(input, null, 2)))),
        errorText && React.createElement("div", { "data-tool-error": "" }, errorText),
        children));
});
ToolInvocation.displayName = "ToolInvocation";
export const ToolResult = React.forwardRef(({ className, output, renderOutput, ...props }, ref) => {
    const content = renderOutput ? renderOutput(output) : JSON.stringify(output, null, 2);
    return (React.createElement("div", { ref: ref, className: className, "data-tool-result": "", ...props }, typeof content === "string" ? React.createElement("pre", null, content) : content));
});
ToolResult.displayName = "ToolResult";
/**
 * Check if a part is a dynamic tool
 */
function isDynamicTool(tool) {
    return tool.type === "dynamic-tool";
}
export const ToolList = React.forwardRef(({ className, tools, renderTool, ...props }, ref) => {
    return (React.createElement("div", { ref: ref, className: className, "data-tool-list": "", ...props }, tools.map((tool) => {
        if (renderTool) {
            return React.createElement(React.Fragment, { key: tool.toolCallId }, renderTool(tool));
        }
        return (React.createElement(ToolInvocation, { key: tool.toolCallId, name: tool.toolName, input: tool.input, state: tool.state, errorText: tool.errorText, dynamic: isDynamicTool(tool) }, tool.output !== undefined && React.createElement(ToolResult, { output: tool.output })));
    })));
});
ToolList.displayName = "ToolList";
