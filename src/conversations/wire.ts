/**
 * Maps SDK inputs to the REST spelling and REST results to the SDK spelling. Message parts
 * and metadata pass through unchanged in both directions.
 */
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

function nullable<T>(value: unknown): T | null {
  return (value ?? null) as T | null;
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
    id: wire.id as string,
    participantId: nullable(wire.participant_id),
    participantType: (wire.participant_type ?? "user") as ConversationParticipantSummary[
      "participantType"
    ],
    userId: nullable(wire.user_id),
    agentId: nullable(wire.agent_id),
    displayName: nullable(wire.display_name),
    avatarUrl: nullable(wire.avatar_url),
    role: wire.role as ConversationParticipantSummary["role"],
  };
}

/** A conversation in the SDK spelling. */
export function fromConversation(wire: Wire): ConversationDetails {
  const participants = Array.isArray(wire.participants) ? wire.participants as Wire[] : [];
  return {
    id: wire.id as string,
    projectId: nullable(wire.project_id),
    respondingAgentId: nullable(wire.responding_agent_id),
    type: wire.type as ConversationDetails["type"],
    title: nullable(wire.title),
    summary: nullable(wire.summary),
    status: wire.status as ConversationDetails["status"],
    currentNode: nullable(wire.current_node),
    messageCount: wire.message_count as number,
    lastMessageAt: nullable(wire.last_message_at),
    metadata: nullable(wire.metadata),
    createdBy: nullable(wire.created_by),
    archivedAt: nullable(wire.archived_at),
    createdAt: wire.created_at as string,
    updatedAt: wire.updated_at as string,
    participants: participants.map(fromParticipantSummary),
    ...("initial_message_id" in wire
      ? { initialMessageId: nullable<string>(wire.initial_message_id) }
      : {}),
  };
}

/** A message in the SDK spelling. */
export function fromMessage(wire: Wire): ConversationMessage {
  return {
    id: wire.id as string,
    conversationId: wire.conversation_id as string,
    parentId: nullable(wire.parent_id),
    seq: wire.seq as number,
    role: wire.role as ConversationMessage["role"],
    createdBy: nullable(wire.created_by),
    senderType: (wire.sender_type ?? "user") as ConversationMessage["senderType"],
    senderId: nullable(wire.sender_id),
    senderDisplayName: nullable(wire.sender_display_name),
    parts: Array.isArray(wire.parts) ? wire.parts as ConversationMessage["parts"] : [],
    model: nullable(wire.model),
    runUsage: nullable(wire.run_usage),
    tokenUsage: nullable(wire.token_usage),
    finishReason: nullable(wire.finish_reason),
    costCredits: nullable(wire.cost_credits),
    status: wire.status as ConversationMessage["status"],
    editedAt: nullable(wire.edited_at),
    idempotencyKey: nullable(wire.idempotency_key),
    metadata: nullable(wire.metadata),
    createdAt: wire.created_at as string,
    updatedAt: nullable(wire.updated_at),
  };
}

/** A participant in the SDK spelling. */
export function fromParticipant(wire: Wire): ConversationParticipant {
  return {
    ...fromParticipantSummary(wire),
    conversationId: wire.conversation_id as string,
    lastReadMessageId: nullable(wire.last_read_message_id),
    notificationPreference: wire.notification_preference as string,
    joinedAt: wire.joined_at as string,
  };
}

/** A read state in the SDK spelling. The REST body does not name the conversation. */
export function fromReadState(wire: Wire, conversationId: string): ConversationReadState {
  return {
    conversationId,
    lastReadMessageId: nullable(wire.last_read_message_id),
    unreadCount: wire.unread_count as number,
  };
}

/** A branch selection in the SDK spelling. */
export function fromBranchSelection(wire: Wire): ConversationBranchSelection {
  return { messageId: nullable(wire.message_id) };
}

function fromPageInfo(wire: unknown): ConversationPageInfo {
  const info = (typeof wire === "object" && wire !== null ? wire : {}) as Wire;
  return {
    self: nullable(info.self),
    first: nullable(info.first),
    next: nullable(info.next),
    prev: nullable(info.prev),
  };
}

/** A page in the SDK spelling, with each item mapped by `item`. */
export function fromPage<T>(wire: Wire, item: (wire: Wire) => T): ConversationPageOf<T> {
  const data = Array.isArray(wire.data) ? wire.data as Wire[] : [];
  return { data: data.map(item), pageInfo: fromPageInfo(wire.page_info) };
}
