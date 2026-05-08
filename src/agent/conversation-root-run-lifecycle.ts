import {
  type ConversationRootRunContext,
  type ConversationRootRunDescriptor,
  createConversationRootRunContext,
  createConversationRootRunStartAdapter,
} from "./conversation-root-run-context.ts";
import { persistLatestConversationUserMessage } from "./conversation-bootstrap.ts";
import {
  type ConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorInstrumentation,
} from "./conversation-run-chunk-mirror.ts";
import { type ConversationRunEvent } from "./conversation-run-events.ts";
import type { ConversationRunProjection } from "./durable.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";

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

export interface HostedConversationRootRunState {
  runId: string;
  conversationId: string;
  messageId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
}

export interface HostedConversationRootRunContext {
  durableRootRun: HostedConversationRootRunState | null;
  durableRunMirror: ConversationRunChunkMirror | null;
  effectiveParentRunId?: string;
  effectiveParentMessageId?: string;
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void>;
}

export interface PrepareHostedConversationRootRunContextInput {
  authToken: string;
  apiUrl: string;
  conversationId?: string;
  projectId?: string | null;
  branchId?: string | null;
  agentId: string;
  implementationKind?: string | null;
  messages: ChatUiMessage[];
  parentRunId?: string;
  parentMessageId?: string;
  providedRun?: ConversationRootRunDescriptor;
  persistLatestUserMessageBeforeRun: boolean;
  persistLatestUserMessageOperation?: string;
  missingUserMessageErrorMessage?: string;
  onPersistLatestUserMessageFailure?: Parameters<
    typeof persistLatestConversationUserMessage
  >[0]["onFailure"];
  instrumentation?: HostedConversationRunChunkMirrorInstrumentation;
}

function isConversationRunEvent(value: unknown): value is ConversationRunEvent {
  return typeof value === "object" && value !== null && "type" in value &&
    typeof value.type === "string";
}

function toHostedConversationRootRunState(
  run: ConversationRunProjection | null,
): HostedConversationRootRunState | null {
  if (!run) {
    return null;
  }

  return {
    runId: run.runId,
    conversationId: run.conversationId,
    messageId: run.messageId,
    latestEventId: run.latestEventId,
    latestExternalEventSequence: run.latestExternalEventSequence,
  };
}

export async function prepareHostedConversationRootRunContext(
  input: PrepareHostedConversationRootRunContextInput,
  options: { abortSignal: AbortSignal },
): Promise<HostedConversationRootRunContext> {
  let durableRunMirror: ConversationRunChunkMirror | null = null;
  const startConversationRootRun = createConversationRootRunStartAdapter({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    projectId: input.projectId,
    branchId: input.branchId,
    agentId: input.agentId,
    implementationKind: input.implementationKind,
    providedRun: input.providedRun,
  });

  const rootRunLifecycle = await prepareConversationRootRunLifecycle(
    {
      startRun: async ({ abortSignal }) => {
        if (!input.providedRun) {
          await persistLatestConversationUserMessage({
            authToken: input.authToken,
            apiUrl: input.apiUrl,
            conversationId: input.conversationId,
            messages: input.messages,
            enabled: input.persistLatestUserMessageBeforeRun,
            operation: input.persistLatestUserMessageOperation,
            missingUserMessageErrorMessage: input.missingUserMessageErrorMessage,
            onFailure: input.onPersistLatestUserMessageFailure,
          });
        }

        return await startConversationRootRun({ abortSignal });
      },
      parentRunId: input.parentRunId,
      parentMessageId: input.parentMessageId,
      appendParentRunEvents: async (events) => {
        if (!durableRunMirror || !events.every(isConversationRunEvent)) {
          return;
        }

        await durableRunMirror.appendEvents(events);
      },
      createMirror: (run) => {
        durableRunMirror = createHostedConversationRunChunkMirror({
          authToken: input.authToken,
          apiUrl: input.apiUrl,
          conversationId: run.conversationId,
          runId: run.runId,
          latestEventId: run.latestEventId,
          latestExternalEventSequence: run.latestExternalEventSequence,
          instrumentation: input.instrumentation,
        });

        return durableRunMirror;
      },
    },
    options,
  );

  durableRunMirror = rootRunLifecycle.mirror;

  return {
    durableRootRun: toHostedConversationRootRunState(rootRunLifecycle.run),
    durableRunMirror,
    effectiveParentRunId: rootRunLifecycle.effectiveParentRunId,
    effectiveParentMessageId: rootRunLifecycle.effectiveParentMessageId,
    publishParentRunEvents: rootRunLifecycle.publishParentRunEvents
      ? async (events) => {
        await rootRunLifecycle.publishParentRunEvents?.(events);
      }
      : undefined,
  };
}
