import { type ConversationRunProjection, createConversationAgentRun } from "./durable.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Public API contract for conversation root run descriptor. */
export interface ConversationRootRunDescriptor {
  runId: string;
  messageId: string;
  latestEventId?: number;
  latestExternalEventSequence?: number;
}

/** Context for conversation root run. */
export interface ConversationRootRunContext {
  run: ConversationRunProjection | null;
  effectiveParentRunId?: string;
  effectiveParentMessageId?: string;
  publishParentRunEvents?: (events: unknown[]) => Promise<void> | void;
}

function normalizeProvidedRun(input: {
  conversationId: string;
  providedRun: ConversationRootRunDescriptor;
}): ConversationRunProjection {
  // The descriptor carries no status, so assume "running"/appendable without a
  // round-trip. If the server-side run is actually terminal or waiting, the
  // first append is rejected and the mirror's resync path lands on
  // non_appendable and disables itself.
  return {
    runId: input.providedRun.runId,
    conversationId: input.conversationId,
    messageId: input.providedRun.messageId,
    latestEventId: input.providedRun.latestEventId ?? 0,
    latestExternalEventSequence: input.providedRun.latestExternalEventSequence ?? 0,
    waitingToolCallId: null,
    waitingToolName: null,
    status: "running",
  };
}

function createMirrorPublisher(
  appendEvents: ((events: unknown[]) => Promise<void> | void) | undefined,
): ConversationRootRunContext["publishParentRunEvents"] {
  return appendEvents ? (events) => appendEvents(events) : undefined;
}

/** Context for create conversation root run. */
export function createConversationRootRunContext(input: {
  run: ConversationRunProjection | null;
  parentRunId?: string;
  parentMessageId?: string;
  appendParentRunEvents?: ((events: unknown[]) => Promise<void> | void) | undefined;
}): ConversationRootRunContext {
  return {
    run: input.run,
    effectiveParentRunId: input.run?.runId ?? input.parentRunId,
    effectiveParentMessageId: input.run?.messageId ?? input.parentMessageId,
    publishParentRunEvents: createMirrorPublisher(input.appendParentRunEvents),
  };
}

/** Starts conversation root run. */
export async function startConversationRootRun(input: {
  authToken: string;
  apiUrl: string;
  conversationId?: string;
  projectId?: string | null;
  branchId?: string | null;
  agentId: string;
  implementationKind?: string | null;
  providedRun?: ConversationRootRunDescriptor;
  abortSignal?: AbortSignal;
}): Promise<ConversationRunProjection | null> {
  if (input.providedRun) {
    if (!input.conversationId) {
      throw INVALID_ARGUMENT.create({ detail: "CONVERSATION_ROOT_RUN_REQUIRES_CONVERSATION" });
    }

    return normalizeProvidedRun({
      conversationId: input.conversationId,
      providedRun: input.providedRun,
    });
  }

  if (!input.conversationId) {
    return null;
  }

  return createConversationAgentRun({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    projectId: input.projectId ?? null,
    branchId: input.branchId,
    agentId: input.agentId,
    implementationKind: input.implementationKind,
    abortSignal: input.abortSignal,
  });
}

/** Create conversation root run start adapter. */
export function createConversationRootRunStartAdapter(input: {
  authToken: string;
  apiUrl: string;
  conversationId?: string;
  projectId?: string | null;
  branchId?: string | null;
  agentId: string;
  implementationKind?: string | null;
  providedRun?: ConversationRootRunDescriptor;
}): (input: { abortSignal: AbortSignal }) => Promise<{ run: ConversationRunProjection | null }> {
  return async ({ abortSignal }) => ({
    run: await startConversationRootRun({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      conversationId: input.conversationId,
      projectId: input.projectId,
      branchId: input.branchId,
      agentId: input.agentId,
      implementationKind: input.implementationKind,
      providedRun: input.providedRun,
      abortSignal,
    }),
  });
}

/** Context for prepare conversation root run. */
export async function prepareConversationRootRunContext(input: {
  authToken: string;
  apiUrl: string;
  conversationId?: string;
  projectId?: string | null;
  branchId?: string | null;
  agentId: string;
  implementationKind?: string | null;
  providedRun?: ConversationRootRunDescriptor;
  parentRunId?: string;
  parentMessageId?: string;
  appendParentRunEvents?: ((events: unknown[]) => Promise<void> | void) | undefined;
}): Promise<ConversationRootRunContext> {
  const { run } = await createConversationRootRunStartAdapter({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    projectId: input.projectId,
    branchId: input.branchId,
    agentId: input.agentId,
    implementationKind: input.implementationKind,
    providedRun: input.providedRun,
  })({ abortSignal: new AbortController().signal });

  return createConversationRootRunContext({
    run,
    parentRunId: input.parentRunId,
    parentMessageId: input.parentMessageId,
    appendParentRunEvents: input.appendParentRunEvents,
  });
}
