import type { ConversationRunProjection } from "./durable.ts";

/** Context for conversation run. */
export interface ConversationRunContext {
  /** Run value. */
  run: ConversationRunProjection | null;
  /** Effective parent run ID value. */
  effectiveParentRunId?: string;
  /** Effective parent message ID value. */
  effectiveParentMessageId?: string;
  /** Callback that handles publish parent run events. */
  publishParentRunEvents?: (events: unknown[]) => Promise<void> | void;
}

/** Context for create conversation run. */
export function createConversationRunContext(input: {
  run: ConversationRunProjection | null;
  parentRunId?: string;
  parentMessageId?: string;
  publishParentRunEvents?: ((events: unknown[]) => Promise<void> | void) | undefined;
}): ConversationRunContext {
  return {
    run: input.run,
    effectiveParentRunId: input.run?.runId ?? input.parentRunId,
    effectiveParentMessageId: input.run?.messageId ?? input.parentMessageId,
    publishParentRunEvents: input.publishParentRunEvents,
  };
}
