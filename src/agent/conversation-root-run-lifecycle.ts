import {
  type ConversationRootRunContext,
  createConversationRootRunContext,
} from "./conversation-root-run-context.ts";
import type { ConversationRunProjection } from "./durable.ts";

export interface ConversationRootRunLifecycle<TMirror> extends ConversationRootRunContext {
  mirror: TMirror | null;
}

export interface PrepareConversationRootRunLifecycleOptions<TMirror> {
  startRun: (
    input: { abortSignal: AbortSignal },
  ) => Promise<{ run: ConversationRunProjection | null }> | {
    run: ConversationRunProjection | null;
  };
  parentRunId?: string;
  parentMessageId?: string;
  appendParentRunEvents?: ((events: unknown[]) => Promise<void> | void) | undefined;
  createMirror?: (
    run: ConversationRunProjection,
  ) => Promise<TMirror> | TMirror;
}

export async function prepareConversationRootRunLifecycle<TMirror>(
  input: PrepareConversationRootRunLifecycleOptions<TMirror>,
  options: { abortSignal: AbortSignal },
): Promise<ConversationRootRunLifecycle<TMirror>> {
  const { run } = await input.startRun({ abortSignal: options.abortSignal });
  const context = createConversationRootRunContext({
    run,
    parentRunId: input.parentRunId,
    parentMessageId: input.parentMessageId,
    appendParentRunEvents: input.appendParentRunEvents,
  });

  return {
    ...context,
    mirror: run && input.createMirror ? await input.createMirror(run) : null,
  };
}
