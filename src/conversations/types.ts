/**
 * Inputs and results of the conversations SDK. Field names are the camelCase spelling of
 * the REST fields; meanings and nullability match the REST API.
 *
 * @module
 */
import type { VeryfrontApiTransport } from "#veryfront/platform/adapters/veryfront-api-transport.ts";

/** Kind of conversation. */
export type ConversationType =
  | "chat"
  | "default_chat"
  | "plan"
  | "research"
  | "agent_task"
  | "support"
  | "channel"
  | "project_agent";

/** Lifecycle status of a conversation. */
export type ConversationStatus = "active" | "archived" | "deleted";

/** Role of a message. */
export type ConversationMessageRole = "user" | "assistant" | "tool";

/** Delivery status of a message. */
export type ConversationMessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

/** Kind of sender that wrote a message. */
export type ConversationMessageSenderType =
  | "user"
  | "webhook"
  | "service_account"
  | "integration"
  | "agent"
  | "system";

/** Kind of participant. */
export type ConversationParticipantType = "user" | "agent";

/** Role of a participant in a conversation. */
export type ConversationParticipantRole = "owner" | "member" | "viewer";

/** Field that orders a conversation list. */
export type ConversationSortBy = "updated_at" | "created_at" | "title" | "message_count";

/** Direction of a conversation list. */
export type ConversationSortOrder = "asc" | "desc";

/**
 * One part of a message, for example `{ type: "text", text: "Hello" }`. The SDK sends and
 * returns parts unchanged, with the field names the REST API uses.
 */
export interface ConversationMessagePart {
  /** Part discriminator, for example `text`. */
  type: string;
  [key: string]: unknown;
}

/** Caller-defined JSON object, sent and returned unchanged. */
export type ConversationMetadata = Record<string, unknown>;

/** Cursors of one page. Pass `next` as `cursor` to read the following page. */
export interface ConversationPageInfo {
  /** Cursor of this page; `null` on the first page. */
  self: string | null;
  /** Cursor of the first page, when the API reports one. */
  first: string | null;
  /** Cursor of the following page; `null` on the last page. */
  next: string | null;
  /** Cursor of the previous page, when the API reports one. */
  prev: string | null;
}

/** One page of a list. */
export interface ConversationPageOf<T> {
  data: T[];
  pageInfo: ConversationPageInfo;
}

/** Participant as a conversation embeds it. */
export interface ConversationParticipantSummary {
  id: string;
  participantId: string | null;
  participantType: ConversationParticipantType;
  userId: string | null;
  agentId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: ConversationParticipantRole;
}

/** A conversation as the API returns it. */
export interface ConversationDetails {
  id: string;
  /** Project the conversation belongs to; `null` for a conversation without a project. */
  projectId: string | null;
  respondingAgentId: string | null;
  type: ConversationType;
  title: string | null;
  summary: string | null;
  status: ConversationStatus;
  /** Message selected as the active branch. */
  currentNode: string | null;
  messageCount: number;
  /** RFC 3339 timestamp of the latest message. */
  lastMessageAt: string | null;
  metadata: ConversationMetadata | null;
  createdBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipantSummary[];
  /**
   * Message created from `initialMessage`; `null` when the conversation started empty. Only
   * `Conversation.create` reports it.
   */
  initialMessageId?: string | null;
}

/** A message of a conversation. */
export interface ConversationMessage {
  id: string;
  conversationId: string;
  parentId: string | null;
  /** Position of the message in the conversation. */
  seq: number;
  role: ConversationMessageRole;
  createdBy: string | null;
  senderType: ConversationMessageSenderType;
  senderId: string | null;
  senderDisplayName: string | null;
  parts: ConversationMessagePart[];
  model: string | null;
  /** Run usage as the REST API reports it, with REST field names. */
  runUsage: Record<string, unknown> | null;
  /** Token usage as the REST API reports it, with REST field names. */
  tokenUsage: Record<string, unknown> | null;
  finishReason: string | null;
  costCredits: string | null;
  status: ConversationMessageStatus;
  editedAt: string | null;
  idempotencyKey: string | null;
  metadata: ConversationMetadata | null;
  createdAt: string;
  updatedAt: string | null;
}

/** A participant of a conversation. */
export interface ConversationParticipant extends ConversationParticipantSummary {
  conversationId: string;
  lastReadMessageId: string | null;
  notificationPreference: string;
  joinedAt: string;
}

/** The caller's read cursor and unread count in a conversation. */
export interface ConversationReadState {
  conversationId: string;
  lastReadMessageId: string | null;
  unreadCount: number;
}

/** The message selected as the active branch of a conversation. */
export interface ConversationBranchSelection {
  messageId: string | null;
}

/** One page of messages. */
export type ConversationMessagePage = ConversationPageOf<ConversationMessage>;

/** One page of participants. */
export type ConversationParticipantPage = ConversationPageOf<ConversationParticipant>;

/** Filters and paging of `Conversation.list`. */
export interface ListConversationsParams {
  /** Project ID or slug. Omit it to list the conversations the credential can read by default. */
  projectReference?: string;
  /** Conversation type to match, for example `chat`. */
  type?: string;
  /** Up to 20 participant IDs. A conversation must include every one of them. */
  participantIds?: string[];
  /** Public agent ID of an agent participant. */
  agentId?: string;
  /** User ID of a user participant. */
  userId?: string;
  /** Case-insensitive text to find in the title. */
  search?: string;
  /** Defaults to `updated_at`. */
  sortBy?: ConversationSortBy;
  /** Defaults to `desc`. */
  sortOrder?: ConversationSortOrder;
  /** Opaque cursor from `pageInfo.next`. */
  cursor?: string;
  /** Page size, 1 to 100. Defaults to 20. */
  limit?: number;
}

/** Message fields shared by `conversation.createMessage` and `initialMessage`. */
export interface CreateConversationInitialMessageInput {
  /** 1 to 200 parts. */
  parts: ConversationMessagePart[];
  /** Must equal the authenticated user. */
  composingUserId?: string;
  /** Up to 255 characters. A retry with the same key returns the same message. */
  idempotencyKey?: string;
  /** JSON object under 64 KB. */
  metadata?: ConversationMetadata;
}

/** Input of `conversation.createMessage`. The SDK sends the message with the `user` role. */
export interface CreateConversationMessageInput extends CreateConversationInitialMessageInput {
  /** Parent message. Defaults to the selected branch. */
  parentId?: string;
}

/** Input of `Conversation.create`. */
export interface CreateConversationInput {
  /** Project ID or slug. */
  projectReference?: string;
  /** Defaults to `chat`. */
  type?: ConversationType;
  title?: string;
  /** JSON object under 64 KB. */
  metadata?: ConversationMetadata;
  /** 1 to 255 characters. A retry with the same input returns the same conversation. */
  idempotencyKey?: string;
  /** First user message, stored together with the conversation. */
  initialMessage?: CreateConversationInitialMessageInput;
}

/** Input of `conversation.update`. */
export interface UpdateConversationInput {
  title?: string;
  summary?: string;
  /** Use `archived` to archive the conversation and `active` to restore it. */
  status?: "active" | "archived";
  /** Project ID or slug to attach the conversation to. */
  projectReference?: string;
}

/** Paging of `conversation.listMessages`. */
export interface ListConversationMessagesParams {
  /** Opaque cursor from `pageInfo.next`. */
  cursor?: string;
  /** Page size, 1 to 100. Defaults to 50. */
  limit?: number;
}

/** Input of `conversation.updateMessage`. */
export interface UpdateConversationMessageInput {
  /** 1 to 200 parts that replace the parts of the message. */
  parts: ConversationMessagePart[];
}

/**
 * Parameters of `conversation.listMessageBranches`. The API returns every branch in one page
 * and accepts no parameters.
 */
export type ListConversationMessageBranchesParams = Record<string, never>;

/** Input of `conversation.createMessageBranch`. */
export interface CreateConversationMessageBranchInput {
  /** 1 to 200 parts of the alternative message. */
  parts: ConversationMessagePart[];
  /** Must equal the authenticated user. */
  composingUserId?: string;
}

/** Input of `conversation.createParticipant`. */
export interface CreateConversationParticipantInput {
  /** User to add. */
  userId: string;
  /** Defaults to `member`. */
  role?: "member" | "viewer";
}

/** Input of `conversation.updateReadState`. */
export interface UpdateConversationReadStateInput {
  /** Message to mark as read. It must belong to the conversation. */
  messageId: string;
}

/** Options of one conversations SDK call. */
export interface ConversationCallOptions {
  /** Cancels the request. */
  signal?: AbortSignal;
}

/** Connection settings of `Conversation.list`, `get`, `create` and `attach`. */
export interface ConversationClientOptions extends ConversationCallOptions {
  /**
   * Canonical Veryfront API transport, including origin, credentials and retries, for example
   * from `createConversationsApiTransport`.
   */
  transport: VeryfrontApiTransport<unknown>;
}

/** Problem body of a failed conversations API request. */
export interface ConversationsProblem {
  /** Problem type URI. */
  type: string;
  title: string;
  /** HTTP status of the response. */
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}
