/**
 * Back-compat aliases for `src/chat`.
 *
 * This module is the single home for the historical `@deprecated` chat exports.
 * Each alias points at a canonical symbol that lives in its originating module
 * (`ag-ui.ts`, `types.ts`, `conversation.ts`, `message-prep.ts`).
 *
 * Imports here are **one-way** — `compat.ts` imports from those modules, and
 * they never import back from `compat.ts`. Keeping the dependency acyclic is
 * deliberate: an earlier attempt that had the public modules re-export these
 * aliases from `compat.ts` introduced a circular import that broke bundled SSR
 * (see issue #1996). Do not add a back-re-export.
 *
 * Removal milestone: target removal in the next minor after 0.2.0. Prefer the
 * canonical symbol named in each `@deprecated` note.
 *
 * @module
 */
import { lazySchema } from "#veryfront/schemas/index.ts";

import {
  getAgUiRunFinishedMetadataSchema,
  getAgUiSnapshotMessageSchema,
  getAgUiSnapshotToolCallSchema,
  getAgUiWireEventNameSchema,
  getAgUiWireEventSchema,
} from "./ag-ui.ts";
import {
  getApiConversationSchema,
  getApiMessageSchema,
  getConversationTypeSchema,
  getMessagePartSchema,
  getMessageStatusSchema,
} from "./conversation.ts";
import { convertUiMessagesToProviderModelMessages } from "./conversation.ts";
import {
  prepareProviderModelMessagesFromUiMessages,
  sanitizeProviderModelMessages,
} from "./message-prep.ts";
import {
  getChatRequestContextSchema,
  getChatToolPartStateSchema,
  getChatUiMessagePartSchema,
  getChatUiMessageRoleSchema,
  getChatUiMessageSchema,
  getChatUiMessagesSchema,
  getMessageMetadataSchema,
} from "./types.ts";
import type { ProviderModelMessage } from "./types.ts";

// ---------------------------------------------------------------------------
// ag-ui.ts
// ---------------------------------------------------------------------------

/** Schema for AG-UI run finished metadata.
 * @deprecated Use getAgUiRunFinishedMetadataSchema()
 */
export const AgUiRunFinishedMetadataSchema = lazySchema(getAgUiRunFinishedMetadataSchema);

/** Schema for AG-UI snapshot tool call.
 * @deprecated Use getAgUiSnapshotToolCallSchema()
 */
export const AgUiSnapshotToolCallSchema = lazySchema(getAgUiSnapshotToolCallSchema);

/** Schema for AG-UI snapshot message.
 * @deprecated Use getAgUiSnapshotMessageSchema()
 */
export const AgUiSnapshotMessageSchema = lazySchema(getAgUiSnapshotMessageSchema);

/** Schema for AG-UI wire event name.
 * @deprecated Use getAgUiWireEventNameSchema()
 */
export const AgUiWireEventNameSchema = lazySchema(getAgUiWireEventNameSchema);

/** Schema for AG-UI wire event.
 * @deprecated Use getAgUiWireEventSchema()
 */
export const AgUiWireEventSchema = lazySchema(getAgUiWireEventSchema);

// ---------------------------------------------------------------------------
// types.ts
// ---------------------------------------------------------------------------

/** Message shape for chat model.
 * @deprecated Use ProviderModelMessage for provider-facing model payloads.
 */
export type ChatModelMessage = ProviderModelMessage;

/** Schema for chat request context.
 * @deprecated Use getChatRequestContextSchema()
 */
export const chatRequestContextSchema = lazySchema(getChatRequestContextSchema);

/** Schema for message metadata.
 * @deprecated Use getMessageMetadataSchema()
 */
export const messageMetadataSchema = lazySchema(getMessageMetadataSchema);

/** Schema for chat ui message role.
 * @deprecated Use getChatUiMessageRoleSchema()
 */
export const chatUiMessageRoleSchema = lazySchema(getChatUiMessageRoleSchema);

/** Schema for chat tool part state.
 * @deprecated Use getChatToolPartStateSchema()
 */
export const chatToolPartStateSchema = lazySchema(getChatToolPartStateSchema);

/** Schema for chat ui message part.
 * @deprecated Use getChatUiMessagePartSchema()
 */
export const chatUiMessagePartSchema = lazySchema(getChatUiMessagePartSchema);

/** Schema for chat ui message.
 * @deprecated Use getChatUiMessageSchema()
 */
export const chatUiMessageSchema = lazySchema(getChatUiMessageSchema);

/** Schema for chat ui messages.
 * @deprecated Use getChatUiMessagesSchema()
 */
export const chatUiMessagesSchema = lazySchema(getChatUiMessagesSchema);

// ---------------------------------------------------------------------------
// conversation.ts
// ---------------------------------------------------------------------------

/** Schema for message part.
 * @deprecated Use getMessagePartSchema()
 */
export const messagePartSchema = lazySchema(getMessagePartSchema);

/** Schema for conversation type.
 * @deprecated Use getConversationTypeSchema()
 */
export const conversationTypeSchema = lazySchema(getConversationTypeSchema);

/** Schema for message status.
 * @deprecated Use getMessageStatusSchema()
 */
export const messageStatusSchema = lazySchema(getMessageStatusSchema);

/** Schema for API conversation.
 * @deprecated Use getApiConversationSchema()
 */
export const apiConversationSchema = lazySchema(getApiConversationSchema);

/** Schema for API message.
 * @deprecated Use getApiMessageSchema()
 */
export const apiMessageSchema = lazySchema(getApiMessageSchema);

/** Shared convert UI messages to model messages value.
 * @deprecated Use convertUiMessagesToProviderModelMessages for provider-facing model payloads.
 */
export const convertUiMessagesToModelMessages = convertUiMessagesToProviderModelMessages;

// ---------------------------------------------------------------------------
// message-prep.ts
// ---------------------------------------------------------------------------

/** Shared sanitize model messages value.
 * @deprecated Use sanitizeProviderModelMessages for provider-facing model payloads.
 */
export const sanitizeModelMessages = sanitizeProviderModelMessages;

/** Shared prepare model messages from UI messages value.
 * @deprecated Use prepareProviderModelMessagesFromUiMessages for provider-facing model payloads.
 */
export const prepareModelMessagesFromUiMessages = prepareProviderModelMessagesFromUiMessages;
