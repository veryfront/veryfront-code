import type { ToolUIPart, UIMessagePart } from "../types.ts";
import { createAssistantMessage, generateClientId } from "../utils.ts";
import { buildCurrentParts } from "./parts-builder.ts";
import type { OrderedReasoning, OrderedToolCall, StreamingCallbacks, TextBlock } from "./types.ts";

interface StreamingState {
  textBlocks: Map<string, TextBlock>;
  toolCalls: Map<string, OrderedToolCall>;
  reasoningBlocks: Map<string, OrderedReasoning>;
  messageParts: UIMessagePart[];
  currentTextId: string;
  messageId: string;
  partOrderCounter: number;
}

function createStreamingState(): StreamingState {
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

export async function handleStreamingResponse(
  body: ReadableStream,
  callbacks: StreamingCallbacks,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = createStreamingState();

  const getBuildParts = (): UIMessagePart[] =>
    buildCurrentParts(state.textBlocks, state.reasoningBlocks, state.toolCalls);

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.trim() || !line.startsWith("data: ")) continue;

      const data = line.slice(6);
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        processEvent(parsed, state, callbacks, getBuildParts);
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

function processEvent(
  parsed: Record<string, unknown>,
  state: StreamingState,
  callbacks: StreamingCallbacks,
  getBuildParts: () => UIMessagePart[],
): void {
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
      onData((parsed.data ?? parsed.value) as unknown);
      return;

    default:
      return;
  }
}

function handleStart(parsed: Record<string, unknown>, state: StreamingState): void {
  state.messageId = (parsed.messageId as string) || generateClientId("msg");
  state.textBlocks.clear();
  state.toolCalls.clear();
  state.reasoningBlocks.clear();
  state.messageParts.length = 0;
}

function handleTextStart(parsed: Record<string, unknown>, state: StreamingState): void {
  state.currentTextId = (parsed.id as string) || generateClientId("text");
  state.textBlocks.set(state.currentTextId, { text: "", state: "streaming", order: null });
}

function handleTextDelta(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const textId = (parsed.id as string) || state.currentTextId || "default";
  const delta = (parsed.textDelta ?? parsed.delta ?? "") as string;

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

function handleTextEnd(parsed: Record<string, unknown>, state: StreamingState): void {
  const textId = (parsed.id as string) || state.currentTextId;
  const block = state.textBlocks.get(textId);
  if (!block) return;

  block.state = "done";
  if (block.text) {
    state.messageParts.push({ type: "text", text: block.text, state: "done" });
  }
}

function handleToolInputStart(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const toolCallId = (parsed.toolCallId as string) || generateClientId("tool");
  const toolCall: OrderedToolCall = {
    toolCallId,
    toolName: (parsed.toolName as string) || "unknown",
    inputText: "",
    state: "input-streaming",
    dynamic: parsed.dynamic === true,
    order: state.partOrderCounter++,
  };

  state.toolCalls.set(toolCallId, toolCall);
  onUpdate?.(getBuildParts(), state.messageId);
}

function handleToolInputDelta(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const toolCallId = parsed.toolCallId as string;
  const toolCall = state.toolCalls.get(toolCallId);
  if (!toolCall) return;

  toolCall.inputText += (parsed.inputTextDelta ?? parsed.delta ?? "") as string;
  onUpdate?.(getBuildParts(), state.messageId);
}

function handleToolInputAvailable(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  onToolCall: StreamingCallbacks["onToolCall"],
  getBuildParts: () => UIMessagePart[],
): void {
  const toolCallId = parsed.toolCallId as string;
  const toolCall = state.toolCalls.get(toolCallId);
  if (!toolCall) return;

  toolCall.input = parsed.input;
  toolCall.toolName = (parsed.toolName as string) || toolCall.toolName;
  toolCall.state = "input-available";
  if (parsed.dynamic === true) toolCall.dynamic = true;

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
  } else {
    state.messageParts.push({
      type: `tool-${toolCall.toolName}` as const,
      toolCallId,
      toolName: toolCall.toolName,
      state: "input-available",
      input: toolCall.input,
    } as ToolUIPart);
  }

  onUpdate?.(getBuildParts(), state.messageId);
}

function handleToolOutputAvailable(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const toolCallId = parsed.toolCallId as string;
  const toolCall = state.toolCalls.get(toolCallId);
  if (!toolCall) return;

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

function handleToolError(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const toolCallId = parsed.toolCallId as string;
  const toolCall = state.toolCalls.get(toolCallId);
  if (!toolCall) return;

  toolCall.state = "output-error";
  toolCall.error = parsed.errorText as string;
  if (parsed.dynamic === true) toolCall.dynamic = true;

  onUpdate?.(getBuildParts(), state.messageId);
}

function handleReasoningStart(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const reasoningId = (parsed.id as string) || generateClientId("reasoning");
  const reasoning: OrderedReasoning = {
    id: reasoningId,
    text: "",
    isComplete: false,
    order: state.partOrderCounter++,
  };

  state.reasoningBlocks.set(reasoningId, reasoning);
  onUpdate?.(getBuildParts(), state.messageId);
}

function handleReasoningDelta(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const reasoningId = parsed.id as string;
  const reasoning = state.reasoningBlocks.get(reasoningId);
  if (!reasoning) return;

  reasoning.text += (parsed.delta ?? "") as string;
  onUpdate?.(getBuildParts(), state.messageId);
}

function handleReasoningEnd(
  parsed: Record<string, unknown>,
  state: StreamingState,
  onUpdate: StreamingCallbacks["onUpdate"],
  getBuildParts: () => UIMessagePart[],
): void {
  const reasoningId = parsed.id as string;
  const reasoning = state.reasoningBlocks.get(reasoningId);
  if (!reasoning) return;

  reasoning.isComplete = true;
  state.messageParts.push({
    type: "reasoning",
    text: reasoning.text,
    state: "done",
  });

  onUpdate?.(getBuildParts(), state.messageId);
}

function handleFinish(
  state: StreamingState,
  onMessage: StreamingCallbacks["onMessage"],
  getBuildParts: () => UIMessagePart[],
): void {
  const finalParts = getBuildParts();
  if (finalParts.length > 0) {
    onMessage(createAssistantMessage(state.messageId, finalParts));
  }
}
