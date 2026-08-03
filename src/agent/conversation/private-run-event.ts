import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED, VeryfrontError } from "../../errors/index.ts";

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** Return whether an event belongs to the private durable run-event sequence. */
export function isPrivateConversationRunEvent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (ownDataValue(value, "type") !== "AGENT_RUN_MODEL_CALL_CONTEXT") return false;
  if (!Array.isArray(ownDataValue(value, "messages"))) return false;
  const tools = ownDataValue(value, "tools");
  if (tools !== undefined && !Array.isArray(tools)) return false;
  return Object.keys(value).every((key) => key === "type" || key === "messages" || key === "tools");
}

/** Failure to persist a required run event before its associated operation. */
export class DurableRunEventPersistenceError extends VeryfrontError {
  override name = "DurableRunEventPersistenceError";

  constructor(detail: string, options: { cause?: unknown } = {}) {
    super(detail, {
      slug: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.slug,
      category: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.category,
      status: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.status,
      title: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.title,
      suggestion: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.suggestion,
      detail,
      cause: options.cause,
    });
    this.name = "DurableRunEventPersistenceError";
  }
}
