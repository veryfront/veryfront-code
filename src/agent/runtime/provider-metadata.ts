import type { Message } from "../types.ts";

const providerMetadataByMessage = new WeakMap<Message, Record<string, unknown>>();

/** Keep provider replay metadata inside one runtime turn without exposing it on public messages. */
export function attachProviderMetadata(
  message: Message,
  providerMetadata: Record<string, unknown> | undefined,
): Message {
  if (providerMetadata !== undefined) {
    providerMetadataByMessage.set(message, providerMetadata);
  }
  return message;
}

/** Read provider replay metadata previously attached to an internal assistant message. */
export function readAttachedProviderMetadata(
  message: Message,
): Record<string, unknown> | undefined {
  return providerMetadataByMessage.get(message);
}

const providerReplayDeliveredValues = new WeakSet<object>();

/**
 * Mark a message whose provider metadata came from a delivered replay
 * checkpoint. Live in-run metadata is never marked, so provider-boundary
 * decisions that must apply only to replayed state can tell the two apart.
 */
export function markProviderReplayDelivered<T extends object>(value: T): T {
  providerReplayDeliveredValues.add(value);
  return value;
}

/** True when the value was marked as carrying delivered replay-checkpoint metadata. */
export function isProviderReplayDelivered(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    providerReplayDeliveredValues.has(value);
}
