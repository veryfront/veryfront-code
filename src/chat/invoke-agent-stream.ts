/** Named data-part contract used to stream a direct child agent inside its parent tool card. */
export const INVOKE_AGENT_STREAM_EVENT_NAME = "veryfront.invoke_agent.stream";

/** One child runtime event associated with its parent `invoke_agent` tool call. */
export interface InvokeAgentStreamValue {
  toolCallId: string;
  agentId: string;
  /** Child agent display name, for the card header (falls back to the id). */
  agentName?: string;
  /** Child agent avatar URL, so the card header matches the main chat header. */
  avatarUrl?: string;
  event: Record<string, unknown> & { type: string };
}

/** Durable, compact representation of all visible events from one child run. */
export interface InvokeAgentStreamSnapshot {
  toolCallId: string;
  agentId: string;
  agentName?: string;
  avatarUrl?: string;
  events: Array<Record<string, unknown> & { type: string }>;
}

/**
 * The child agent's identity carried alongside its event stream.
 *
 * `avatarUrl` (not the message-metadata spelling `agentAvatarUrl`) matches the
 * `invoke_agent` tool output field the card already falls back to, so both
 * sources of the child avatar read the same key.
 */
export interface InvokeAgentStreamIdentity {
  agentName?: string;
  avatarUrl?: string;
}

/** Read the child agent's display identity from a live value or a snapshot. */
export function getInvokeAgentStreamIdentity(value: unknown): InvokeAgentStreamIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    agentName: typeof record.agentName === "string" ? record.agentName : undefined,
    avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : undefined,
  };
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
    ...(typeof record.agentName === "string" ? { agentName: record.agentName } : {}),
    ...(typeof record.avatarUrl === "string" ? { avatarUrl: record.avatarUrl } : {}),
    event: event as InvokeAgentStreamValue["event"],
  };
}

/** Return one or more child events from either a live event or a compact snapshot. */
export function getInvokeAgentStreamEvents(
  value: unknown,
): Array<Record<string, unknown> & { type: string }> {
  const single = parseInvokeAgentStreamValue(value);
  if (single) return [single.event];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const events = (value as Record<string, unknown>).events;
  if (!Array.isArray(events)) return [];
  return events.filter((event): event is Record<string, unknown> & { type: string } =>
    Boolean(event) && typeof event === "object" && !Array.isArray(event) &&
    typeof (event as Record<string, unknown>).type === "string"
  );
}

function mergeConsecutiveDeltas(
  events: Array<Record<string, unknown> & { type: string }>,
): Array<Record<string, unknown> & { type: string }> {
  const compacted: Array<Record<string, unknown> & { type: string }> = [];
  for (const event of events) {
    const previous = compacted.at(-1);
    const deltaKey = event.type === "tool-input-delta" ? "inputTextDelta" : "delta";
    const sameStream = previous?.type === event.type &&
      previous?.id === event.id && previous?.toolCallId === event.toolCallId &&
      typeof previous?.[deltaKey] === "string" && typeof event[deltaKey] === "string";
    if (sameStream) {
      previous[deltaKey] = `${previous[deltaKey]}${event[deltaKey]}`;
    } else {
      compacted.push({ ...event });
    }
  }
  return compacted;
}

/**
 * Upsert a child event into its parent message part.
 *
 * The chat persistence contract bounds message parts, so every live child
 * event for one parent tool call must share one durable part. Consecutive
 * deltas are compacted without changing their visible order.
 */
export function appendInvokeAgentStreamSnapshot(
  existing: unknown,
  next: unknown,
): InvokeAgentStreamSnapshot | null {
  const nextValue = parseInvokeAgentStreamValue(next);
  if (!nextValue) return null;
  const existingEvents = getInvokeAgentStreamEvents(existing);
  if (existingEvents.length === 0) return null;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return null;
  const existingRecord = existing as Record<string, unknown>;
  if (
    existingRecord.toolCallId !== nextValue.toolCallId ||
    existingRecord.agentId !== nextValue.agentId
  ) {
    return null;
  }
  const identity: InvokeAgentStreamIdentity = {
    agentName: nextValue.agentName ??
      (typeof existingRecord.agentName === "string" ? existingRecord.agentName : undefined),
    avatarUrl: nextValue.avatarUrl ??
      (typeof existingRecord.avatarUrl === "string" ? existingRecord.avatarUrl : undefined),
  };
  return {
    toolCallId: nextValue.toolCallId,
    agentId: nextValue.agentId,
    ...(identity.agentName ? { agentName: identity.agentName } : {}),
    ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
    events: mergeConsecutiveDeltas([...existingEvents, nextValue.event]),
  };
}
