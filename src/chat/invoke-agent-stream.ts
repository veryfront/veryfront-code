/** Named data-part contract used to stream a direct child agent inside its parent tool card. */
export const INVOKE_AGENT_STREAM_EVENT_NAME = "veryfront.invoke_agent.stream";

/** One child runtime event associated with its parent `invoke_agent` tool call. */
export interface InvokeAgentStreamValue {
  toolCallId: string;
  agentId: string;
  event: Record<string, unknown> & { type: string };
}

/** Build the generic tool data event consumed by the chat renderer. */
export function buildInvokeAgentStreamDataEvent(value: InvokeAgentStreamValue): {
  type: typeof INVOKE_AGENT_STREAM_EVENT_NAME;
  name: typeof INVOKE_AGENT_STREAM_EVENT_NAME;
  value: InvokeAgentStreamValue;
} {
  return {
    type: INVOKE_AGENT_STREAM_EVENT_NAME,
    name: INVOKE_AGENT_STREAM_EVENT_NAME,
    value,
  };
}

/** Parse an untrusted chat data part into the child-stream contract. */
export function parseInvokeAgentStreamValue(value: unknown): InvokeAgentStreamValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const event = record.event;
  if (
    typeof record.toolCallId !== "string" ||
    typeof record.agentId !== "string" ||
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    typeof (event as Record<string, unknown>).type !== "string"
  ) {
    return null;
  }

  return {
    toolCallId: record.toolCallId,
    agentId: record.agentId,
    event: event as InvokeAgentStreamValue["event"],
  };
}
