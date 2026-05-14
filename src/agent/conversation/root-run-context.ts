import { type ConversationRunProjection, createConversationAgentRun } from "../durable.ts";

export interface ConversationRootRunDescriptor {
  runId: string;
  messageId: string;
  latestEventId?: number;
  latestExternalEventSequence?: number;
}

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

export async function startConversationRootRun(input: {
  authToken: string;
  apiUrl: string;
  conversationId?: string;
  projectId?: string | null;
  branchId?: string | null;
  agentId: string;
  implementationKind?: string | null;
  providedRun?: ConversationRootRunDescriptor;
}): Promise<ConversationRunProjection | null> {
  if (input.providedRun) {
    if (!input.conversationId) {
      throw new Error("CONVERSATION_ROOT_RUN_REQUIRES_CONVERSATION");
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
  });
}

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
  return async () => ({
    run: await startConversationRootRun({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      conversationId: input.conversationId,
      projectId: input.projectId,
      branchId: input.branchId,
      agentId: input.agentId,
      implementationKind: input.implementationKind,
      providedRun: input.providedRun,
    }),
  });
}

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
