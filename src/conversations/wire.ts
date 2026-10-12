/**
 * Maps SDK inputs to the REST spelling and REST results to the SDK spelling. Message parts
 * and metadata pass through unchanged in both directions.
 */
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import type { ConversationsWireInput } from "./request.ts";
import type {
  ConversationBranchSelection,
  ConversationDetails,
  ConversationMessage,
  ConversationPageInfo,
  ConversationPageOf,
  ConversationParticipant,
  ConversationParticipantSummary,
  ConversationReadState,
  CreateConversationInitialMessageInput,
  CreateConversationInput,
  CreateConversationMessageBranchInput,
  CreateConversationMessageInput,
  CreateConversationParticipantInput,
  ListConversationMessagesParams,
  ListConversationsParams,
  UpdateConversationInput,
} from "./types.ts";

type Wire = Record<string, unknown>;

/** Copy the defined fields of an input into a wire body under their REST names. */
function defined(fields: Record<string, unknown>): Wire {
  const body: Wire = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) body[name] = value;
  }
  return body;
}

/** Reject a success body that does not have the documented shape. The value is not echoed. */
function invalid(field: string, expected: string): never {
  throw API_CLIENT_ERROR.create({
    detail: `The conversations API returned an invalid response: ${field} must be ${expected}`,
    status: 502,
    context: { field },
  });
}

function isObject(value: unknown): value is Wire {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str<T extends string = string>(wire: Wire, field: string): T {
  const value = wire[field];
  if (typeof value !== "string") invalid(field, "a string");
  return value as T;
}

function num(wire: Wire, field: string): number {
  const value = wire[field];
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field, "a number");
  return value;
}

/** A string field that the API may omit or send as `null`. */
function optStr<T extends string = string>(wire: Wire, field: string): T | null {
  const value = wire[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid(field, "a string or null");
  return value as T;
}

/** A string field that the API always sends, as a string or `null`. */
function nullableStr(wire: Wire, field: string): string | null {
  if (!(field in wire)) invalid(field, "a string or null");
  return optStr(wire, field);
}

/** An object field that the API may omit or send as `null`. */
function optObj(wire: Wire, field: string): Wire | null {
  const value = wire[field];
  if (value === undefined || value === null) return null;
  if (!isObject(value)) invalid(field, "an object or null");
  return value;
}

function objects(value: unknown, field: string): Wire[] {
  if (!Array.isArray(value) || !value.every(isObject)) invalid(field, "an array of objects");
  return value;
}

function userMessageFields(input: CreateConversationInitialMessageInput): Wire {
  return defined({
    role: "user",
    parts: input.parts,
    composing_user_id: input.composingUserId,
    idempotency_key: input.idempotencyKey,
    metadata: input.metadata,
  });
}

/** Query of `listConversations`. */
export function toListConversationsQuery(
  params: ListConversationsParams,
): ConversationsWireInput["query"] {
  return {
    project_reference: params.projectReference,
    type: params.type,
    participant_ids: params.participantIds?.length ? params.participantIds.join(",") : undefined,
    agent_id: params.agentId,
    user_id: params.userId,
    search: params.search,
    sort_by: params.sortBy,
    sort_order: params.sortOrder,
    cursor: params.cursor,
    limit: params.limit,
  };
}

/** Query of `listConversationMessages`. */
export function toListMessagesQuery(
  params: ListConversationMessagesParams,
): ConversationsWireInput["query"] {
  return { cursor: params.cursor, limit: params.limit };
}

/** Body of `createConversation`. */
export function toCreateConversationBody(input: CreateConversationInput): Wire {
  return defined({
    project_reference: input.projectReference,
    type: input.type,
    title: input.title,
    metadata: input.metadata,
    idempotency_key: input.idempotencyKey,
    initial_message: input.initialMessage ? userMessageFields(input.initialMessage) : undefined,
  });
}

/** Body of `updateConversation`. */
export function toUpdateConversationBody(input: UpdateConversationInput): Wire {
  return defined({
    title: input.title,
    summary: input.summary,
    status: input.status,
    project_reference: input.projectReference,
  });
}

/** Body of `createConversationMessage`. */
export function toCreateMessageBody(input: CreateConversationMessageInput): Wire {
  return { ...userMessageFields(input), ...defined({ parent_id: input.parentId }) };
}

/** Body of `createConversationMessageBranch`. */
export function toCreateMessageBranchBody(input: CreateConversationMessageBranchInput): Wire {
  return defined({ parts: input.parts, composing_user_id: input.composingUserId });
}

/** Body of `createConversationParticipant`. */
export function toCreateParticipantBody(input: CreateConversationParticipantInput): Wire {
  return defined({ user_id: input.userId, role: input.role });
}

function fromParticipantSummary(wire: Wire): ConversationParticipantSummary {
  return {
    id: str(wire, "id"),
    participantId: optStr(wire, "participant_id"),
    participantType: optStr<ConversationParticipantSummary["participantType"]>(
      wire,
      "participant_type",
    ) ?? "user",
    userId: optStr(wire, "user_id"),
    agentId: optStr(wire, "agent_id"),
    displayName: optStr(wire, "display_name"),
    avatarUrl: optStr(wire, "avatar_url"),
    role: str<ConversationParticipantSummary["role"]>(wire, "role"),
  };
}

/** A conversation in the SDK spelling. */
export function fromConversation(wire: Wire): ConversationDetails {
  const participants = wire.participants === undefined
    ? []
    : objects(wire.participants, "participants");
  return {
    id: str(wire, "id"),
    projectId: optStr(wire, "project_id"),
    respondingAgentId: optStr(wire, "responding_agent_id"),
    type: str<ConversationDetails["type"]>(wire, "type"),
    title: optStr(wire, "title"),
    summary: optStr(wire, "summary"),
    status: str<ConversationDetails["status"]>(wire, "status"),
    currentNode: optStr(wire, "current_node"),
    messageCount: num(wire, "message_count"),
    lastMessageAt: optStr(wire, "last_message_at"),
    metadata: optObj(wire, "metadata"),
    createdBy: optStr(wire, "created_by"),
    archivedAt: optStr(wire, "archived_at"),
    createdAt: str(wire, "created_at"),
    updatedAt: str(wire, "updated_at"),
    participants: participants.map(fromParticipantSummary),
    ...("initial_message_id" in wire
      ? { initialMessageId: optStr(wire, "initial_message_id") }
      : {}),
  };
}

/** A message in the SDK spelling. */
export function fromMessage(wire: Wire): ConversationMessage {
  return {
    id: str(wire, "id"),
    conversationId: str(wire, "conversation_id"),
    parentId: optStr(wire, "parent_id"),
    seq: num(wire, "seq"),
    role: str<ConversationMessage["role"]>(wire, "role"),
    createdBy: optStr(wire, "created_by"),
    senderType: optStr<ConversationMessage["senderType"]>(wire, "sender_type") ?? "user",
    senderId: optStr(wire, "sender_id"),
    senderDisplayName: optStr(wire, "sender_display_name"),
    parts: objects(wire.parts, "parts") as ConversationMessage["parts"],
    model: optStr(wire, "model"),
    runUsage: optObj(wire, "run_usage"),
    tokenUsage: optObj(wire, "token_usage"),
    finishReason: optStr(wire, "finish_reason"),
    costCredits: optStr(wire, "cost_credits"),
    status: str<ConversationMessage["status"]>(wire, "status"),
    editedAt: optStr(wire, "edited_at"),
    idempotencyKey: optStr(wire, "idempotency_key"),
    metadata: optObj(wire, "metadata"),
    createdAt: str(wire, "created_at"),
    updatedAt: optStr(wire, "updated_at"),
  };
}

/** A participant in the SDK spelling. */
export function fromParticipant(wire: Wire): ConversationParticipant {
  return {
    ...fromParticipantSummary(wire),
    conversationId: str(wire, "conversation_id"),
    lastReadMessageId: optStr(wire, "last_read_message_id"),
    notificationPreference: str(wire, "notification_preference"),
    joinedAt: str(wire, "joined_at"),
  };
}

/** A read state in the SDK spelling. The REST body does not name the conversation. */
export function fromReadState(wire: Wire, conversationId: string): ConversationReadState {
  return {
    conversationId,
    lastReadMessageId: nullableStr(wire, "last_read_message_id"),
    unreadCount: num(wire, "unread_count"),
  };
}

/** A branch selection in the SDK spelling. */
export function fromBranchSelection(wire: Wire): ConversationBranchSelection {
  return { messageId: nullableStr(wire, "message_id") };
}

function fromPageInfo(wire: unknown): ConversationPageInfo {
  if (!isObject(wire)) invalid("page_info", "an object");
  return {
    self: optStr(wire, "self"),
    first: optStr(wire, "first"),
    // A page without `next` would read as the last page, so the cursor must be present.
    next: nullableStr(wire, "next"),
    prev: optStr(wire, "prev"),
  };
}

/**
 * A page in the SDK spelling, with each item mapped by `item`. A body without a `data` array
 * or a `page_info` object is rejected, so it cannot read as an empty list.
 */
export function fromPage<T>(wire: Wire, item: (wire: Wire) => T): ConversationPageOf<T> {
  const data = objects(wire.data, "data");
  return { data: data.map(item), pageInfo: fromPageInfo(wire.page_info) };
}
