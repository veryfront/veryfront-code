/**
 * Conversations: the durable threads of messages, branches, participants and read state
 * between people and agents. Runs and input requests of a conversation are in
 * `veryfront/runs/target`.
 *
 * @module
 *
 * @example Create a conversation and add a message
 * ```ts
 * import { Conversation, createConversationsApiTransport } from "veryfront/conversations";
 *
 * const transport = createConversationsApiTransport({
 *   baseUrl: "<API_ORIGIN>",
 *   getToken: () => process.env.VERYFRONT_API_TOKEN!,
 * });
 *
 * const conversation = await Conversation.create(
 *   { projectReference: "<PROJECT_ID>", title: "Release notes" },
 *   { transport },
 * );
 * const message = await conversation.createMessage({
 *   parts: [{ type: "text", text: "Draft the release notes." }],
 * });
 * console.log(conversation.id, message.id);
 * ```
 *
 * @example List, read, update and delete conversations
 * ```ts
 * import { Conversation, createConversationsApiTransport } from "veryfront/conversations";
 *
 * const transport = createConversationsApiTransport({
 *   baseUrl: "<API_ORIGIN>",
 *   getToken: () => process.env.VERYFRONT_API_TOKEN!,
 * });
 *
 * const page = await Conversation.list({ projectReference: "<PROJECT_ID>", limit: 20 }, { transport });
 * console.log(page.data.map((item) => item.details?.title), page.pageInfo.next);
 *
 * const conversation = await Conversation.get("<CONVERSATION_ID>", { transport });
 * const archived = await conversation.update({ status: "archived" });
 * console.log(archived.details?.status); // "archived"
 * await archived.delete();
 * ```
 *
 * @example Read messages and work with branches
 * ```ts
 * import { Conversation, createConversationsApiTransport } from "veryfront/conversations";
 *
 * const transport = createConversationsApiTransport({
 *   baseUrl: "<API_ORIGIN>",
 *   getToken: () => process.env.VERYFRONT_API_TOKEN!,
 * });
 * // attach() uses a known conversation ID without reading the conversation first.
 * const conversation = Conversation.attach("<CONVERSATION_ID>", { transport });
 *
 * let cursor: string | undefined;
 * do {
 *   const page = await conversation.listMessages({ cursor, limit: 50 });
 *   for (const message of page.data) console.log(message.seq, message.role);
 *   cursor = page.pageInfo.next ?? undefined;
 * } while (cursor);
 *
 * const message = await conversation.getMessage("<MESSAGE_ID>");
 * await conversation.updateMessage(message.id, { parts: [{ type: "text", text: "Edited text." }] });
 * const branch = await conversation.createMessageBranch(message.id, {
 *   parts: [{ type: "text", text: "Another version." }],
 * });
 * const branches = await conversation.listMessageBranches("<PARENT_MESSAGE_ID>");
 * console.log(branches.data.length);
 * await conversation.updateBranchSelection(branch.id);
 * await conversation.deleteMessage(branch.id);
 * ```
 *
 * @example Manage participants and read state
 * ```ts
 * import {
 *   Conversation,
 *   conversationsProblemOf,
 *   createConversationsApiTransport,
 * } from "veryfront/conversations";
 *
 * const transport = createConversationsApiTransport({
 *   baseUrl: "<API_ORIGIN>",
 *   getToken: () => process.env.VERYFRONT_API_TOKEN!,
 * });
 * const conversation = Conversation.attach("<CONVERSATION_ID>", { transport });
 *
 * await conversation.createParticipant({ userId: "<USER_ID>", role: "viewer" });
 * const participants = await conversation.listParticipants();
 * console.log(participants.data.map((participant) => participant.role));
 * await conversation.deleteParticipant("<USER_ID>");
 *
 * const readState = await conversation.getReadState();
 * console.log(readState.unreadCount);
 * try {
 *   await conversation.updateReadState({ messageId: "<MESSAGE_ID>" });
 * } catch (error) {
 *   // A failed request carries the API problem body, for example status 404.
 *   console.error(conversationsProblemOf(error)?.status);
 * }
 * ```
 */

export { Conversation, type ConversationPage } from "./conversation.ts";
export { conversationsProblemOf } from "./request.ts";
export { CONVERSATIONS_OPERATIONS, type ConversationsOperationRoute } from "./operations.ts";
export {
  type ConversationsApiTransportOptions,
  createConversationsApiTransport,
} from "./transport.ts";
export type {
  ConversationBranchSelection,
  ConversationCallOptions,
  ConversationClientOptions,
  ConversationDetails,
  ConversationMessage,
  ConversationMessagePage,
  ConversationMessagePart,
  ConversationMessageRole,
  ConversationMessageSenderType,
  ConversationMessageStatus,
  ConversationMetadata,
  ConversationPageInfo,
  ConversationPageOf,
  ConversationParticipant,
  ConversationParticipantPage,
  ConversationParticipantRole,
  ConversationParticipantSummary,
  ConversationParticipantType,
  ConversationReadState,
  ConversationSortBy,
  ConversationSortOrder,
  ConversationsProblem,
  ConversationStatus,
  ConversationType,
  CreateConversationInitialMessageInput,
  CreateConversationInput,
  CreateConversationMessageBranchInput,
  CreateConversationMessageInput,
  CreateConversationParticipantInput,
  ListConversationMessageBranchesParams,
  ListConversationMessagesParams,
  ListConversationsParams,
  UpdateConversationInput,
  UpdateConversationMessageInput,
  UpdateConversationReadStateInput,
} from "./types.ts";
export type {
  TransportRetryConfig,
  VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
