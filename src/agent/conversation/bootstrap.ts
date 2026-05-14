import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { isUuid, toConversationPartsFromUiMessage } from "#veryfront/chat/conversation.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import { type ConversationRunProjection, createConversationAgentRun } from "../durable.ts";

const CONVERSATION_API_TIMEOUT_MS = 15_000;

// Hand-written transform output type.
export interface ConversationRecord {
  id: string;
  projectId: string | null;
}

export const getConversationRecordSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    projectId: v.string().nullable().optional(),
    project_id: v.string().nullable().optional(),
  })
    .passthrough()
    .transform((data): ConversationRecord => {
      const d = data as Record<string, unknown>;
      return {
        id: d.id as string,
        projectId: (d.projectId as string | null | undefined) ??
          (d.project_id as string | null | undefined) ?? null,
      };
    })
);

/** @deprecated Use getConversationRecordSchema() */
export const ConversationRecordSchema = lazySchema(getConversationRecordSchema);

export const getConversationMessageRecordSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
  })
);

/** @deprecated Use getConversationMessageRecordSchema() */
export const ConversationMessageRecordSchema = lazySchema(getConversationMessageRecordSchema);

export type ConversationMessageRecord = InferSchema<
  ReturnType<typeof getConversationMessageRecordSchema>
>;

export interface ConversationControlPlaneResponseError {
  status: number;
  statusText: string;
  body: string;
}

export interface PersistConversationUserMessageFailure
  extends ConversationControlPlaneResponseError {
  conversationId: string;
  messageId: string;
}

async function controlPlaneJson<T>(input: {
  authToken: string;
  url: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  responseSchema: Schema<T>;
  operation: string;
  onResponseError?: (error: ConversationControlPlaneResponseError) => void;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONVERSATION_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        "Content-Type": "application/json",
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${input.operation} timed out after ${CONVERSATION_API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    input.onResponseError?.({
      status: response.status,
      statusText: response.statusText,
      body,
    });
    throw new Error(
      `${input.operation} failed (${response.status}): ${body || response.statusText}`,
    );
  }

  return input.responseSchema.parse(await response.json());
}

function buildConversationPath(apiUrl: string, conversationId: string): string {
  return `${apiUrl}/conversations/${conversationId}`;
}

function buildConversationMessagesPath(apiUrl: string, conversationId: string): string {
  return `${buildConversationPath(apiUrl, conversationId)}/messages`;
}

export async function fetchConversationRecord(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
}): Promise<ConversationRecord> {
  return controlPlaneJson({
    authToken: input.authToken,
    url: buildConversationPath(input.apiUrl, input.conversationId),
    responseSchema: ConversationRecordSchema,
    operation: "Fetch conversation",
  });
}

export async function ensureConversationProjectLink(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  projectId: string;
}): Promise<void> {
  const conversation = await fetchConversationRecord(input);

  if (conversation.projectId === input.projectId) return;
  if (conversation.projectId !== null) {
    throw new Error(
      `Conversation ${input.conversationId} is already linked to a different project (${conversation.projectId})`,
    );
  }

  await controlPlaneJson({
    authToken: input.authToken,
    url: buildConversationPath(input.apiUrl, input.conversationId),
    method: "PATCH",
    body: { project_id: input.projectId },
    responseSchema: ConversationRecordSchema,
    operation: "Link conversation to project",
  });
}

export async function createConversationRecord(input: {
  authToken: string;
  apiUrl: string;
  body: unknown;
}): Promise<ConversationRecord> {
  return controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/conversations`,
    method: "POST",
    body: input.body,
    responseSchema: ConversationRecordSchema,
    operation: "Create conversation",
  });
}

export async function createConversationMessage(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  body: unknown;
  operation?: string;
  onResponseError?: (error: ConversationControlPlaneResponseError) => void;
}): Promise<ConversationMessageRecord> {
  return controlPlaneJson({
    authToken: input.authToken,
    url: buildConversationMessagesPath(input.apiUrl, input.conversationId),
    method: "POST",
    body: input.body,
    responseSchema: ConversationMessageRecordSchema,
    operation: input.operation ?? "Create conversation message",
    onResponseError: input.onResponseError,
  });
}

export async function persistConversationUserMessage(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  message: ChatUiMessage;
  parentMessageId?: string;
  operation?: string;
  onFailure?: (failure: PersistConversationUserMessageFailure) => void;
}): Promise<ConversationMessageRecord> {
  const parts = toConversationPartsFromUiMessage(input.message);
  if (parts.length === 0) {
    throw new Error("CONVERSATION_USER_MESSAGE_REQUIRES_PERSISTABLE_PARTS");
  }

  return createConversationMessage({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    operation: input.operation ?? "Persist conversation user message",
    body: {
      role: "user",
      parts,
      idempotency_key: input.message.id,
      ...(isUuid(input.parentMessageId) ? { parent_id: input.parentMessageId } : {}),
      ...(input.message.metadata ? { metadata: input.message.metadata } : {}),
    },
    onResponseError: (error) => {
      input.onFailure?.({
        conversationId: input.conversationId,
        messageId: input.message.id,
        ...error,
      });
    },
  });
}

export function findLatestUserConversationMessageContext(messages: ChatUiMessage[]): {
  latestUserMessage: ChatUiMessage | undefined;
  visibleParentMessageId?: string;
} {
  const latestUserMessageIndex = messages.findLastIndex((message) => message.role === "user");
  const latestUserMessage = latestUserMessageIndex >= 0
    ? messages[latestUserMessageIndex]
    : undefined;

  if (latestUserMessageIndex >= 0) {
    for (let index = latestUserMessageIndex - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message && message.role !== "system") {
        return {
          latestUserMessage,
          visibleParentMessageId: message.id,
        };
      }
    }
  }

  return {
    latestUserMessage,
  };
}

export async function persistLatestConversationUserMessage(input: {
  authToken: string;
  apiUrl: string;
  conversationId?: string;
  messages: ChatUiMessage[];
  enabled: boolean;
  operation?: string;
  missingUserMessageErrorMessage?: string;
  onFailure?: (failure: PersistConversationUserMessageFailure) => void;
}): Promise<void> {
  if (!input.enabled || !input.conversationId) {
    return;
  }

  const { latestUserMessage, visibleParentMessageId } = findLatestUserConversationMessageContext(
    input.messages,
  );
  if (!latestUserMessage) {
    throw new Error(input.missingUserMessageErrorMessage ?? "CONVERSATION_REQUIRES_USER_MESSAGE");
  }

  await persistConversationUserMessage({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    message: latestUserMessage,
    operation: input.operation,
    ...(isUuid(visibleParentMessageId) ? { parentMessageId: visibleParentMessageId } : {}),
    ...(input.onFailure ? { onFailure: input.onFailure } : {}),
  });
}

export interface BootstrapConversationAgentRunResult {
  conversation: ConversationRecord;
  message: ConversationMessageRecord;
  run: ConversationRunProjection;
}

export async function bootstrapConversationAgentRun(input: {
  authToken: string;
  apiUrl: string;
  parentConversationId?: string;
  ensureProjectId?: string;
  conversationBody: unknown;
  handoffMessageBody: unknown;
  runId?: string;
  agentId: string;
  implementationKind?: string | null;
  projectId?: string | null;
  branchId?: string | null;
}): Promise<BootstrapConversationAgentRunResult> {
  if (input.parentConversationId && input.ensureProjectId) {
    await ensureConversationProjectLink({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      conversationId: input.parentConversationId,
      projectId: input.ensureProjectId,
    });
  }

  const conversation = await createConversationRecord({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    body: input.conversationBody,
  });
  const effectiveProjectId = input.projectId ?? conversation.projectId;
  const message = await createConversationMessage({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: conversation.id,
    body: input.handoffMessageBody,
  });
  const run = await createConversationAgentRun({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: conversation.id,
    runId: input.runId,
    agentId: input.agentId,
    implementationKind: input.implementationKind,
    projectId: effectiveProjectId,
    branchId: input.branchId,
  });

  return { conversation, message, run };
}
