import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import type { ConversationSummary } from "../persistence/conversation-store.ts";
import {
  conversationSummary,
  createEmptyConversation,
  DEFAULT_CONVERSATION_TITLE,
  deriveTitle,
  nextActiveAfterRemove,
  upsertSummary,
} from "./use-conversations.ts";

function userMsg(text: string): ChatMessage {
  return { id: `m-${text}`, role: "user", parts: [{ type: "text", text }] } as ChatMessage;
}

function summary(id: string, updatedAt: number): ConversationSummary {
  return { id, title: id, messageCount: 0, createdAt: updatedAt, updatedAt };
}

describe("useConversations helpers — createEmptyConversation", () => {
  it("makes an empty, untitled draft with injectable id/now", () => {
    const c = createEmptyConversation({ id: "c1", now: 1000 });
    assertEquals(c.id, "c1");
    assertEquals(c.title, DEFAULT_CONVERSATION_TITLE);
    assertEquals(c.messages, []);
    assertEquals(c.createdAt, 1000);
    assertEquals(c.updatedAt, 1000);
    assertEquals("agentId" in c, false);
  });

  it("carries an agentId when given", () => {
    assertEquals(createEmptyConversation({ agentId: "support" }).agentId, "support");
  });
});

describe("useConversations helpers — deriveTitle", () => {
  it("uses the first user message text", () => {
    assertEquals(deriveTitle([userMsg("Hello there")]), "Hello there");
  });

  it("returns empty when there is no user message", () => {
    const assistant = {
      id: "a",
      role: "assistant",
      parts: [{ type: "text", text: "hi" }],
    } as ChatMessage;
    assertEquals(deriveTitle([assistant]), "");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "x".repeat(60);
    const title = deriveTitle([userMsg(long)]);
    assertEquals(title.length, 41, "40 chars + ellipsis");
    assertEquals(title.endsWith("…"), true);
  });

  it("joins multiple text parts and trims", () => {
    const msg = {
      id: "m",
      role: "user",
      parts: [
        { type: "text", text: "  a" },
        { type: "text", text: "b  " },
      ],
    } as ChatMessage;
    assertEquals(deriveTitle([msg]), "ab");
  });
});

describe("useConversations helpers — conversationSummary", () => {
  it("derives messageCount and drops messages", () => {
    const s = conversationSummary({
      id: "c",
      title: "T",
      messages: [userMsg("a"), userMsg("b")],
      createdAt: 1,
      updatedAt: 2,
    });
    assertEquals(s.messageCount, 2);
    assertEquals("messages" in s, false);
  });
});

describe("useConversations helpers — upsertSummary", () => {
  it("inserts newest-first", () => {
    const next = upsertSummary([summary("a", 100)], summary("b", 200));
    assertEquals(next.map((s) => s.id), ["b", "a"]);
  });

  it("replaces an existing id without duplicating", () => {
    const updated = { ...summary("a", 300), title: "Renamed" };
    const next = upsertSummary([summary("a", 100), summary("b", 200)], updated);
    assertEquals(next.length, 2);
    assertEquals(next[0]?.id, "a", "a is now newest");
    assertEquals(next[0]?.title, "Renamed");
  });
});

describe("useConversations helpers — nextActiveAfterRemove", () => {
  it("returns the newest remaining", () => {
    const list = [summary("b", 200), summary("a", 100)];
    assertEquals(nextActiveAfterRemove(list, "b"), "a");
  });

  it("returns null when nothing remains", () => {
    assertEquals(nextActiveAfterRemove([summary("a", 100)], "a"), null);
  });
});
