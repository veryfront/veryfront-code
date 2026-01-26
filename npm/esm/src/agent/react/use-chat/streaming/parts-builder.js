export function buildCurrentParts(textBlocks, reasoningBlocks, toolCalls) {
    const orderedParts = [];
    addTextParts(orderedParts, textBlocks);
    addReasoningParts(orderedParts, reasoningBlocks);
    addToolParts(orderedParts, toolCalls);
    return orderedParts.sort((a, b) => a.order - b.order).map(({ part }) => part);
}
function addTextParts(orderedParts, textBlocks) {
    for (const block of textBlocks.values()) {
        if (!block.text || block.order === null)
            continue;
        orderedParts.push({
            order: block.order,
            part: { type: "text", text: block.text, state: block.state },
        });
    }
}
function addReasoningParts(orderedParts, reasoningBlocks) {
    for (const reasoning of reasoningBlocks.values()) {
        orderedParts.push({
            order: reasoning.order,
            part: {
                type: "reasoning",
                text: reasoning.text,
                state: reasoning.isComplete ? "done" : "streaming",
            },
        });
    }
}
function addToolParts(orderedParts, toolCalls) {
    for (const tool of toolCalls.values()) {
        const base = {
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            state: tool.state,
            input: tool.input,
            output: tool.output,
            errorText: tool.error,
        };
        if (tool.dynamic) {
            orderedParts.push({
                order: tool.order,
                part: { type: "dynamic-tool", ...base },
            });
            continue;
        }
        orderedParts.push({
            order: tool.order,
            part: { type: `tool-${tool.toolName}`, ...base },
        });
    }
}
