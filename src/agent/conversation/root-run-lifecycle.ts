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
import {
  createRuntimeObservationWriterCapability,
  hasRuntimeObservationCaptureOptIn,
  revokeRuntimeObservationWriterCapability,
  type RuntimeObservationCaptureOptIn,
  type RuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import type { ConversationRunProjection } from "./durable.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import { DurableRunEventPersistenceError } from "./private-run-event.ts";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  getActiveHostedRunEventWriterCapability,
  hostedRunCanonicalId,
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
  /** Opaque capability privately proved by the exact-run writer capability. */
  privateRuntimeObservationWriterCapability?: RuntimeObservationWriterCapability;
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
  /** Host-owned default-off opt-in for exact model-call capture. */
  runtimeObservationCaptureOptIn?: RuntimeObservationCaptureOptIn;
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

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function revokeRuntimeObservationWriterOnMirrorDispose(
  mirror: ConversationRunChunkMirror,
  capability: RuntimeObservationWriterCapability,
): ConversationRunChunkMirror {
  return {
    timing: mirror.timing,
    handleChunk: (chunk) => mirror.handleChunk(chunk),
    appendEvents: (events) => mirror.appendEvents(events),
    ...(mirror.takeModelCallCaptureReceipt
      ? {
        takeModelCallCaptureReceipt: (modelCallId: string) =>
          mirror.takeModelCallCaptureReceipt?.(modelCallId),
      }
      : {}),
    ...(mirror.takeToolCallAdmissionReceipt
      ? {
        takeToolCallAdmissionReceipt: (occurrenceId: string) =>
          mirror.takeToolCallAdmissionReceipt?.(occurrenceId),
      }
      : {}),
    flush: (options) => mirror.flush(options),
    getSnapshot: () => mirror.getSnapshot(),
    dispose: () => {
      revokeRuntimeObservationWriterCapability(capability);
      mirror.dispose();
    },
  };
}

/** Context for prepare hosted conversation root run. */
export async function prepareHostedConversationRootRunContext(
  input: PrepareHostedConversationRootRunContextInput,
  options: { abortSignal: AbortSignal },
): Promise<HostedConversationRootRunContext> {
  if (input.conversationId && !input.providedRun) {
    throw new Error(
      "An API-issued durable root run descriptor is required before hosted conversation execution",
    );
  }
  let durableRunMirror: ConversationRunChunkMirror | null = null;
  let privateDurableRunMirror: ConversationRunChunkMirror | null = null;
  let privateRuntimeObservationWriterCapability: RuntimeObservationWriterCapability | undefined;
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
        const canonicalRunId = hostedRunCanonicalId(runEventWriterCapability, run.runId);
        const enableRuntimeObservations = hasRuntimeObservationCaptureOptIn(
          input.runtimeObservationCaptureOptIn,
        ) && isUuid(canonicalRunId) && isUuid(input.projectId);
        const mirrorOptions = {
          conversationId: run.conversationId,
          latestEventId: run.latestEventId,
          latestExternalEventSequence: run.latestExternalEventSequence,
          instrumentation: input.instrumentation,
        };
        privateDurableRunMirror = createHostedConversationRunChunkMirrorFromCapability(
          runEventWriterCapability,
          {
            ...mirrorOptions,
            expectedRunId: run.runId,
            ...(enableRuntimeObservations ? { runtimeObservations: true } : {}),
          },
        ) ?? null;
        privateRuntimeObservationWriterCapability =
          privateDurableRunMirror && enableRuntimeObservations
            ? createRuntimeObservationWriterCapability({
              scope: {
                runId: run.runId,
                canonicalRunId,
                projectId: input.projectId,
              },
              assertActive: () => {
                const snapshot = privateDurableRunMirror?.getSnapshot();
                if (!snapshot || snapshot.disabled) {
                  throw new DurableRunEventPersistenceError(
                    "Model call capture scope is no longer active",
                  );
                }
              },
            })
            : undefined;
        if (privateDurableRunMirror && privateRuntimeObservationWriterCapability) {
          privateDurableRunMirror = revokeRuntimeObservationWriterOnMirrorDispose(
            privateDurableRunMirror,
            privateRuntimeObservationWriterCapability,
          );
        }
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
    ...(privateRuntimeObservationWriterCapability
      ? { privateRuntimeObservationWriterCapability }
      : {}),
    effectiveParentRunId: rootRunLifecycle.effectiveParentRunId,
    effectiveParentMessageId: rootRunLifecycle.effectiveParentMessageId,
    publishParentRunEvents: rootRunLifecycle.publishParentRunEvents
      ? async (events) => {
        await rootRunLifecycle.publishParentRunEvents?.(events);
      }
      : undefined,
  };
}
