import type { ChatUiMessagePart } from "./types.ts";

type ToolUiPart = Extract<ChatUiMessagePart, { toolCallId: string; state: string }>;

/** Build the terminal error part used when chat execution stops or fails. */
export function markToolPartAsErrored(part: ToolUiPart, errorText: string): ChatUiMessagePart {
  if (part.type === "dynamic-tool") {
    return {
      type: "dynamic-tool",
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      ...(part.title ? { title: part.title } : {}),
      ...(part.providerExecuted !== undefined ? { providerExecuted: part.providerExecuted } : {}),
      ...(part.callProviderMetadata ? { callProviderMetadata: part.callProviderMetadata } : {}),
      input: part.input,
      state: "output-error",
      errorText,
    };
  }

  return {
    type: part.type,
    toolCallId: part.toolCallId,
    ...(part.toolName ? { toolName: part.toolName } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(part.providerExecuted !== undefined ? { providerExecuted: part.providerExecuted } : {}),
    ...(part.callProviderMetadata ? { callProviderMetadata: part.callProviderMetadata } : {}),
    input: part.input,
    state: "output-error",
    errorText,
  };
}
