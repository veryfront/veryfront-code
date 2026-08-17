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
