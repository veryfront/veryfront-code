import { createAssistantMessage, generateClientId } from "../utils.js";
import { buildCurrentParts } from "./parts-builder.js";
function createStreamingState() {
    return {
        textBlocks: new Map(),
        toolCalls: new Map(),
        reasoningBlocks: new Map(),
        messageParts: [],
        currentTextId: "",
        messageId: "",
        partOrderCounter: 0,
    };
}
export async function handleStreamingResponse(body, callbacks) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const state = createStreamingState();
    const getBuildParts = () => buildCurrentParts(state.textBlocks, state.reasoningBlocks, state.toolCalls);
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            return;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
            if (!line.trim() || !line.startsWith("data: "))
                continue;
            const data = line.slice(6);
            try {
                const parsed = JSON.parse(data);
                processEvent(parsed, state, callbacks, getBuildParts);
            }
            catch {
                // Skip invalid JSON
            }
        }
    }
}
function processEvent(parsed, state, callbacks, getBuildParts) {
    const { onMessage, onData, onUpdate, onToolCall } = callbacks;
    switch (parsed.type) {
        case "start":
            handleStart(parsed, state);
            return;
        case "start-step":
        case "finish-step":
            return;
        case "text-start":
            handleTextStart(parsed, state);
            return;
        case "text-delta":
            handleTextDelta(parsed, state, onUpdate, getBuildParts);
            return;
        case "text-end":
            handleTextEnd(parsed, state);
            return;
        case "tool-input-start":
            handleToolInputStart(parsed, state, onUpdate, getBuildParts);
            return;
        case "tool-input-delta":
            handleToolInputDelta(parsed, state, onUpdate, getBuildParts);
            return;
        case "tool-input-available":
            handleToolInputAvailable(parsed, state, onUpdate, onToolCall, getBuildParts);
            return;
        case "tool-output-available":
            handleToolOutputAvailable(parsed, state, onUpdate, getBuildParts);
            return;
        case "tool-input-error":
        case "tool-output-error":
            handleToolError(parsed, state, onUpdate, getBuildParts);
            return;
        case "reasoning-start":
            handleReasoningStart(parsed, state, onUpdate, getBuildParts);
            return;
        case "reasoning-delta":
            handleReasoningDelta(parsed, state, onUpdate, getBuildParts);
            return;
        case "reasoning-end":
            handleReasoningEnd(parsed, state, onUpdate, getBuildParts);
            return;
        case "finish":
            handleFinish(state, onMessage, getBuildParts);
            return;
        case "data":
            onData((parsed.data ?? parsed.value));
            return;
        default:
            return;
    }
}
function handleStart(parsed, state) {
    state.messageId = parsed.messageId || generateClientId("msg");
    state.textBlocks.clear();
    state.toolCalls.clear();
    state.reasoningBlocks.clear();
    state.messageParts.length = 0;
}
function handleTextStart(parsed, state) {
    state.currentTextId = parsed.id || generateClientId("text");
    state.textBlocks.set(state.currentTextId, { text: "", state: "streaming", order: null });
}
function handleTextDelta(parsed, state, onUpdate, getBuildParts) {
    const textId = parsed.id || state.currentTextId || "default";
    const delta = (parsed.textDelta ?? parsed.delta ?? "");
    let block = state.textBlocks.get(textId);
    if (!block) {
        block = { text: "", state: "streaming", order: null };
        state.textBlocks.set(textId, block);
        state.currentTextId = textId;
    }
    block.text += delta;
    if (block.order === null) {
        block.order = state.partOrderCounter++;
    }
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleTextEnd(parsed, state) {
    const textId = parsed.id || state.currentTextId;
    const block = state.textBlocks.get(textId);
    if (!block)
        return;
    block.state = "done";
    if (block.text) {
        state.messageParts.push({ type: "text", text: block.text, state: "done" });
    }
}
function handleToolInputStart(parsed, state, onUpdate, getBuildParts) {
    const toolCallId = parsed.toolCallId || generateClientId("tool");
    const toolCall = {
        toolCallId,
        toolName: parsed.toolName || "unknown",
        inputText: "",
        state: "input-streaming",
        dynamic: parsed.dynamic === true,
        order: state.partOrderCounter++,
    };
    state.toolCalls.set(toolCallId, toolCall);
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleToolInputDelta(parsed, state, onUpdate, getBuildParts) {
    const toolCallId = parsed.toolCallId;
    const toolCall = state.toolCalls.get(toolCallId);
    if (!toolCall)
        return;
    toolCall.inputText += (parsed.inputTextDelta ?? parsed.delta ?? "");
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleToolInputAvailable(parsed, state, onUpdate, onToolCall, getBuildParts) {
    const toolCallId = parsed.toolCallId;
    const toolCall = state.toolCalls.get(toolCallId);
    if (!toolCall)
        return;
    toolCall.input = parsed.input;
    toolCall.toolName = parsed.toolName || toolCall.toolName;
    toolCall.state = "input-available";
    if (parsed.dynamic === true)
        toolCall.dynamic = true;
    onToolCall?.({
        toolCall: {
            toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            dynamic: toolCall.dynamic,
        },
    });
    if (toolCall.dynamic) {
        state.messageParts.push({
            type: "dynamic-tool",
            toolCallId,
            toolName: toolCall.toolName,
            state: "input-available",
            input: toolCall.input,
        });
    }
    else {
        state.messageParts.push({
            type: `tool-${toolCall.toolName}`,
            toolCallId,
            toolName: toolCall.toolName,
            state: "input-available",
            input: toolCall.input,
        });
    }
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleToolOutputAvailable(parsed, state, onUpdate, getBuildParts) {
    const toolCallId = parsed.toolCallId;
    const toolCall = state.toolCalls.get(toolCallId);
    if (!toolCall)
        return;
    toolCall.output = parsed.output;
    toolCall.state = "output-available";
    state.messageParts.push({
        type: "tool-result",
        toolCallId,
        toolName: toolCall.toolName,
        result: toolCall.output,
    });
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleToolError(parsed, state, onUpdate, getBuildParts) {
    const toolCallId = parsed.toolCallId;
    const toolCall = state.toolCalls.get(toolCallId);
    if (!toolCall)
        return;
    toolCall.state = "output-error";
    toolCall.error = parsed.errorText;
    if (parsed.dynamic === true)
        toolCall.dynamic = true;
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleReasoningStart(parsed, state, onUpdate, getBuildParts) {
    const reasoningId = parsed.id || generateClientId("reasoning");
    const reasoning = {
        id: reasoningId,
        text: "",
        isComplete: false,
        order: state.partOrderCounter++,
    };
    state.reasoningBlocks.set(reasoningId, reasoning);
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleReasoningDelta(parsed, state, onUpdate, getBuildParts) {
    const reasoningId = parsed.id;
    const reasoning = state.reasoningBlocks.get(reasoningId);
    if (!reasoning)
        return;
    reasoning.text += (parsed.delta ?? "");
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleReasoningEnd(parsed, state, onUpdate, getBuildParts) {
    const reasoningId = parsed.id;
    const reasoning = state.reasoningBlocks.get(reasoningId);
    if (!reasoning)
        return;
    reasoning.isComplete = true;
    state.messageParts.push({
        type: "reasoning",
        text: reasoning.text,
        state: "done",
    });
    onUpdate?.(getBuildParts(), state.messageId);
}
function handleFinish(state, onMessage, getBuildParts) {
    const finalParts = getBuildParts();
    if (finalParts.length > 0) {
        onMessage(createAssistantMessage(state.messageId, finalParts));
    }
}
