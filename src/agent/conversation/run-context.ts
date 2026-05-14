import type { ConversationRunProjection } from "../durable.ts";

export interface ConversationRunContext {
  run: ConversationRunProjection | null;
  effectiveParentRunId?: string;
  effectiveParentMessageId?: string;
  publishParentRunEvents?: (events: unknown[]) => Promise<void> | void;
}

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
