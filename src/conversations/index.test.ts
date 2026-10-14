import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as conversationsModule from "./index.ts";
import * as publicConversationsModule from "veryfront/conversations";
import { Conversation } from "./conversation.ts";
import { CONVERSATIONS_OPERATIONS } from "./operations.ts";
import { conversationsProblemOf } from "./request.ts";
import { createConversationsApiTransport } from "./transport.ts";

const expectedRuntimeExports = [
  "CONVERSATIONS_OPERATIONS",
  "Conversation",
  "conversationsProblemOf",
  "createConversationsApiTransport",
];

describe("conversations/index.ts exports", () => {
  it("publishes the conversations SDK at veryfront/conversations", () => {
    assertEquals(Object.keys(conversationsModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicConversationsModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(publicConversationsModule.Conversation, Conversation);
    assertStrictEquals(publicConversationsModule.conversationsProblemOf, conversationsProblemOf);
    assertStrictEquals(
      publicConversationsModule.CONVERSATIONS_OPERATIONS,
      CONVERSATIONS_OPERATIONS,
    );
    assertStrictEquals(
      publicConversationsModule.createConversationsApiTransport,
      createConversationsApiTransport,
    );
  });

  it("names every canonical conversations operation with its method and path", () => {
    assertEquals(CONVERSATIONS_OPERATIONS, {
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
    });
  });
});
