/** HTTP route of one conversations operation. */
export interface ConversationsOperationRoute {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** URL template with `{parameter}` placeholders. */
  path: string;
}

/** Method and path of each conversations operation, keyed by the REST operation ID. */
export const CONVERSATIONS_OPERATIONS = {
  listConversations: { method: "GET", path: "/conversations" },
  createConversation: { method: "POST", path: "/conversations" },
  getConversation: { method: "GET", path: "/conversations/{conversation_id}" },
  updateConversation: { method: "PATCH", path: "/conversations/{conversation_id}" },
  deleteConversation: { method: "DELETE", path: "/conversations/{conversation_id}" },
  listConversationMessages: {
    method: "GET",
    path: "/conversations/{conversation_id}/messages",
  },
  createConversationMessage: {
    method: "POST",
    path: "/conversations/{conversation_id}/messages",
  },
  getConversationMessage: {
    method: "GET",
    path: "/conversations/{conversation_id}/messages/{message_id}",
  },
  updateConversationMessage: {
    method: "PATCH",
    path: "/conversations/{conversation_id}/messages/{message_id}",
  },
  deleteConversationMessage: {
    method: "DELETE",
    path: "/conversations/{conversation_id}/messages/{message_id}",
  },
  listConversationMessageBranches: {
    method: "GET",
    path: "/conversations/{conversation_id}/messages/{message_id}/branches",
  },
  createConversationMessageBranch: {
    method: "POST",
    path: "/conversations/{conversation_id}/messages/{message_id}/branches",
  },
  updateConversationBranchSelection: {
    method: "PUT",
    path: "/conversations/{conversation_id}/branch-selection",
  },
  listConversationParticipants: {
    method: "GET",
    path: "/conversations/{conversation_id}/participants",
  },
  createConversationParticipant: {
    method: "POST",
    path: "/conversations/{conversation_id}/participants",
  },
  deleteConversationParticipant: {
    method: "DELETE",
    path: "/conversations/{conversation_id}/participants/{user_id}",
  },
  getConversationReadState: {
    method: "GET",
    path: "/conversations/{conversation_id}/read-state",
  },
  updateConversationReadState: {
    method: "PUT",
    path: "/conversations/{conversation_id}/read-state",
  },
} as const satisfies Record<string, ConversationsOperationRoute>;

/** REST operation ID of a conversations operation. */
export type ConversationsOperationId = keyof typeof CONVERSATIONS_OPERATIONS;
