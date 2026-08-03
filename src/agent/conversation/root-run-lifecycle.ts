import {
  type ConversationRootRunContext,
  type ConversationRootRunDescriptor,
  createConversationRootRunContext,
  createConversationRootRunStartAdapter,
} from "./root-run-context.ts";
import { persistLatestConversationUserMessage } from "./bootstrap.ts";
import {
  type ConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorInstrumentation,
} from "./run-chunk-mirror.ts";
import { type ConversationRunEvent } from "./run-events.ts";
import type { ConversationRunProjection } from "./durable.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  getActiveHostedRunEventWriterCapability,
} from "../hosted/child-run-event-writer-token.ts";

/** Public API contract for conversation root run lifecycle. */
export interface ConversationRootRunLifecycle<TMirror> extends ConversationRootRunContext {
  mirror: TMirror | null;
}

/** Options accepted by prepare conversation root run lifecycle. */
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

/** Prepare conversation root run lifecycle. */
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

/** State for hosted conversation root run. */
export interface HostedConversationRootRunState {
  runId: string;
  conversationId: string;
  messageId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
}

/** Context for hosted conversation root run. */
export interface HostedConversationRootRunContext {
  durableRootRun: HostedConversationRootRunState | null;
  durableRunMirror: ConversationRunChunkMirror | null;
  /** Mirror authorized for private checkpoint events, when a service token was verified. */
  privateDurableRunMirror: ConversationRunChunkMirror | null;
  effectiveParentRunId?: string;
  effectiveParentMessageId?: string;
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void>;
}

/**
 * Input for hosted root-run preparation.
 *
 * Exact-root event-writer authority is supplied only by the framework's
 * bounded capability scope; this input does not accept raw writer tokens.
 */
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

/** Context for prepare hosted conversation root run. */
export async function prepareHostedConversationRootRunContext(
  input: PrepareHostedConversationRootRunContextInput,
  options: { abortSignal: AbortSignal },
): Promise<HostedConversationRootRunContext> {
  let durableRunMirror: ConversationRunChunkMirror | null = null;
  let privateDurableRunMirror: ConversationRunChunkMirror | null = null;
  const runEventWriterCapability = getActiveHostedRunEventWriterCapability();
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
        const mirrorOptions = {
          conversationId: run.conversationId,
          latestEventId: run.latestEventId,
          latestExternalEventSequence: run.latestExternalEventSequence,
          instrumentation: input.instrumentation,
        };
        privateDurableRunMirror = createHostedConversationRunChunkMirrorFromCapability(
          runEventWriterCapability,
          { ...mirrorOptions, expectedRunId: run.runId },
        ) ?? null;
        durableRunMirror = privateDurableRunMirror ?? createHostedConversationRunChunkMirror({
          ...mirrorOptions,
          apiUrl: input.apiUrl,
          authToken: input.authToken,
          runId: run.runId,
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
    privateDurableRunMirror,
    effectiveParentRunId: rootRunLifecycle.effectiveParentRunId,
    effectiveParentMessageId: rootRunLifecycle.effectiveParentMessageId,
    publishParentRunEvents: rootRunLifecycle.publishParentRunEvents
      ? async (events) => {
        await rootRunLifecycle.publishParentRunEvents?.(events);
      }
      : undefined,
  };
}
