import type { ConversationRunProjection } from "./durable.ts";

/** Context for conversation run. */
export interface ConversationRunContext {
  run: ConversationRunProjection | null;
  effectiveParentRunId?: string;
  effectiveParentMessageId?: string;
  publishParentRunEvents?: (events: unknown[]) => Promise<void> | void;
}

/** Context for create conversation run. */
export function createConversationRunContext(input: {
  run: ConversationRunProjection | null;
  parentRunId?: string;
  parentMessageId?: string;
  publishParentRunEvents?: ((events: unknown[]) => Promise<void> | void) | undefined;
}) {
  return {
    run: input.run,
    effectiveParentRunId: input.run?.runId ?? input.parentRunId,
    effectiveParentMessageId: input.run?.messageId ?? input.parentMessageId,
    publishParentRunEvents: input.publishParentRunEvents,
  };
}
