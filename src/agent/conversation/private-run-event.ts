/** Return whether an event belongs to the private durable run-event sequence. */
export function isPrivateConversationRunEvent(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" &&
      (value as Record<string, unknown>).type === "AGENT_RUN_MODEL_CALL_CONTEXT",
  );
}

/** Failure to persist a required run event before its associated operation. */
export class DurableRunEventPersistenceError extends Error {
  override name = "DurableRunEventPersistenceError";
}
