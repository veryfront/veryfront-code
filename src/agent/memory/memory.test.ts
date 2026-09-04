import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BufferMemory,
  captureMemoryRollback,
  ConversationMemory,
  createAgentMemory,
  createMemory,
  NoMemory,
  SummaryMemory,
} from "./memory.ts";
import type { MinimalMessage } from "./memory-interface.ts";

function userMessage(id: string, text: string): MinimalMessage {
  return { id, role: "user", parts: [{ type: "text", text } as { type: string }] };
}

describe("NoMemory", () => {
  it("never persists added messages", async () => {
    const memory = new NoMemory();
    await memory.add(userMessage("1", "hello"));
    await memory.add(userMessage("2", "world"));
    assertEquals(await memory.getMessages(), []);
  });

  it("reports empty stats with type 'none'", async () => {
    const memory = new NoMemory();
    await memory.add(userMessage("1", "hello"));
    assertEquals(await memory.getStats(), {
      totalMessages: 0,
      estimatedTokens: 0,
      type: "none",
    });
  });

  it("clear is a no-op", async () => {
    const memory = new NoMemory();
    await memory.clear();
    assertEquals(await memory.getMessages(), []);
  });
});

describe("createAgentMemory", () => {
  it("returns NoMemory when no config is provided (stateless default)", () => {
    assertInstanceOf(createAgentMemory(), NoMemory);
  });

  it("returns NoMemory when memory is disabled", () => {
    assertInstanceOf(
      createAgentMemory({ type: "conversation", enabled: false }),
      NoMemory,
    );
  });

  it("builds the configured store when memory is enabled", () => {
    assertInstanceOf(createAgentMemory({ type: "conversation" }), ConversationMemory);
    assertInstanceOf(createAgentMemory({ type: "buffer" }), BufferMemory);
    assertInstanceOf(createAgentMemory({ type: "summary" }), SummaryMemory);
    // enabled: true is the implicit default and stays stateful.
    assertInstanceOf(
      createAgentMemory({ type: "conversation", enabled: true }),
      ConversationMemory,
    );
  });

  it("createMemory still builds a stateful store directly", () => {
    assertInstanceOf(createMemory({ type: "conversation" }), ConversationMemory);
  });
});

describe("ConversationMemory", () => {
  it("accumulates messages and reports stats", async () => {
    const memory = new ConversationMemory({ type: "conversation" });
    await memory.add(userMessage("1", "hello"));
    await memory.add(userMessage("2", "world"));
    assertEquals((await memory.getMessages()).length, 2);
    const stats = await memory.getStats();
    assertEquals(stats.totalMessages, 2);
    assertEquals(stats.type, "conversation");
  });

  it("trims to maxMessages, keeping the most recent", async () => {
    const memory = new ConversationMemory({ type: "conversation", maxMessages: 2 });
    await memory.add(userMessage("1", "a"));
    await memory.add(userMessage("2", "b"));
    await memory.add(userMessage("3", "c"));
    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages.map((m) => m.id), ["2", "3"]);
  });

  it("trims to maxTokens while keeping at least one message", async () => {
    const memory = new ConversationMemory({ type: "conversation", maxTokens: 1 });
    await memory.add(userMessage("1", "a".repeat(400)));
    await memory.add(userMessage("2", "b".repeat(400)));
    const messages = await memory.getMessages();
    assertEquals(messages.length, 1);
    assertEquals(messages[0].id, "2");
  });

  it("clear empties the store", async () => {
    const memory = new ConversationMemory({ type: "conversation" });
    await memory.add(userMessage("1", "a"));
    await memory.clear();
    assertEquals(await memory.getMessages(), []);
  });

  it("does not resurrect a snapshot after a concurrent clear", async () => {
    const memory = new ConversationMemory({ type: "conversation" });
    await memory.add(userMessage("history", "accepted history"));
    const rollback = captureMemoryRollback(memory, await memory.getMessages());
    const rejected = userMessage("rejected", "rejected input");
    await memory.add(rejected);
    await memory.clear();

    await rollback.rollback(new Set([rejected]));

    assertEquals(await memory.getMessages(), []);
  });

  it("removes a rejected write added after a concurrent clear", async () => {
    const memory = new ConversationMemory({ type: "conversation" });
    await memory.add(userMessage("history", "accepted history"));
    const rollback = captureMemoryRollback(memory, await memory.getMessages());
    await memory.clear();
    const rejected = userMessage("rejected", "rejected input");
    await memory.add(rejected);

    await rollback.rollback(new Set([rejected]));

    assertEquals(await memory.getMessages(), []);
  });

  it("does not replay an in-flight addition already present in the snapshot", async () => {
    const memory = new ConversationMemory({ type: "conversation", maxTokens: 100 });
    const concurrent = userMessage("assistant", "concurrent output");
    const addition = memory.add(concurrent);
    const rollback = captureMemoryRollback(memory, []);
    await addition;
    const rejected = userMessage("rejected", "rejected input");
    await memory.add(rejected);

    await rollback.rollback(new Set([rejected]));

    assertEquals((await memory.getMessages()).map((message) => message.id), ["assistant"]);
  });
});

describe("BufferMemory", () => {
  it("keeps only the last bufferSize messages", async () => {
    const memory = new BufferMemory({ type: "buffer", maxMessages: 2 });
    await memory.add(userMessage("1", "a"));
    await memory.add(userMessage("2", "b"));
    await memory.add(userMessage("3", "c"));
    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages.map((m) => m.id), ["2", "3"]);
  });

  it("defaults the buffer size to 10", async () => {
    const memory = new BufferMemory({ type: "buffer" });
    for (let i = 0; i < 12; i++) await memory.add(userMessage(String(i), "x"));
    assertEquals((await memory.getMessages()).length, 10);
  });
});

describe("SummaryMemory", () => {
  it("holds messages verbatim below the summarization threshold", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 4 });
    await memory.add(userMessage("1", "hi"));
    await memory.add(userMessage("2", "there"));
    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages.every((m) => m.id !== "summary"), true);
  });

  it("summarizes older messages once the threshold is crossed", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    await memory.add(userMessage("1", "first topic"));
    await memory.add(userMessage("2", "second topic"));
    await memory.add(userMessage("3", "third topic"));
    const messages = await memory.getMessages();
    // A synthesized summary message is prepended once summarization has run.
    assertEquals(messages[0].id, "summary");
    assertEquals(messages.length > 1, true);
  });

  it("accumulates prior context across repeated resummarizations (no overwrite)", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    // Cross the threshold multiple times so summarizeOldMessages runs repeatedly.
    for (let i = 1; i <= 8; i++) await memory.add(userMessage(String(i), `topic ${i}`));
    const summaryText = (await memory.getMessages())[0];
    const text = (summaryText.parts as Array<{ text?: string }>)[0].text ?? "";
    // The rolling summary must retain earlier topics, not just the latest batch.
    assertEquals(text.includes("topic 1"), true);
    assertEquals(text.split("Discussed:").length > 2, true);
  });

  it("keeps the rolling summary bounded across repeated resummarizations", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    for (let i = 1; i <= 300; i++) {
      await memory.add(userMessage(String(i), `topic ${i} ${"x".repeat(50)}`));
    }

    const summaryMessage = (await memory.getMessages())[0]!;
    const text = (summaryMessage.parts as Array<{ text?: string }>)[0]?.text ?? "";
    const summary = text.slice(text.indexOf("\n") + 1);

    assertEquals(summary.length <= 4_000, true);
    assertEquals(summary.includes("topic 1"), true);
    assertEquals(summary.includes("topic 298"), true);
  });

  it("enforces maxTokens across the summary and retained message tail", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 4, maxTokens: 40 });
    for (let i = 1; i <= 8; i++) {
      await memory.add(userMessage(String(i), `topic ${i} ${"x".repeat(70)}`));
    }

    const messages = await memory.getMessages();
    const stats = await memory.getStats();

    assertEquals(stats.estimatedTokens <= 40, true);
    assertEquals(messages.some((message) => message.id === "8"), true);
  });

  it("drops the rolling summary when the retained tail alone consumes maxTokens", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2, maxTokens: 20 });
    for (let i = 1; i <= 4; i++) {
      await memory.add(userMessage(String(i), `topic ${i} ${"y".repeat(120)}`));
    }

    const messages = await memory.getMessages();

    assertEquals(
      messages.some((message) => message.id === "summary"),
      false,
      "the rolling summary is discarded when the retained tail alone exhausts maxTokens",
    );
    assertEquals(
      messages.map((message) => message.id),
      ["4"],
      "only the newest message is retained",
    );
  });

  it("reports stats including summary tokens and clears fully", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    for (let i = 1; i <= 6; i++) await memory.add(userMessage(String(i), `topic ${i}`));
    const stats = await memory.getStats();
    assertEquals(stats.type, "summary");
    assertEquals(stats.estimatedTokens > 0, true);

    await memory.clear();
    assertEquals(await memory.getMessages(), []);
  });

  it("restores the private summary state without replaying its projection", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    await memory.add(userMessage("1", "first topic"));
    await memory.add(userMessage("2", "second topic"));
    await memory.add(userMessage("3", "third topic"));
    const before = await memory.getMessages();
    const rollback = captureMemoryRollback(memory, before);

    await memory.add(userMessage("4", "fourth topic"));
    await memory.add(userMessage("5", "fifth topic"));
    await rollback.rollback();

    const after = await memory.getMessages();
    assertEquals(
      after.map((message) => ({ id: message.id, role: message.role, parts: message.parts })),
      before.map((message) => ({ id: message.id, role: message.role, parts: message.parts })),
    );
    await memory.add(userMessage("4", "fourth topic"));
    assertEquals(
      (await memory.getMessages()).filter((message) => message.id === "summary").length,
      1,
      "the restored projection must remain private summary state",
    );
  });

  it("preserves a concurrent model write while rolling back rejected input", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 4 });
    await memory.add(userMessage("history", "accepted history"));
    const before = await memory.getMessages();
    const transaction = captureMemoryRollback(memory, before);
    const rejected = userMessage("rejected", "rejected input");
    const concurrent = {
      ...userMessage("assistant", "concurrent model output"),
      role: "assistant" as const,
    };

    await memory.add(rejected);
    await memory.add(concurrent);
    await transaction.rollback(new Set([rejected]));

    assertEquals(
      (await memory.getMessages()).map((message) => message.id),
      ["history", "assistant"],
    );
  });

  it("does not resurrect summary state after a concurrent clear", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    for (let index = 1; index <= 3; index++) {
      await memory.add(userMessage(String(index), `topic ${index}`));
    }
    const rollback = captureMemoryRollback(memory, await memory.getMessages());
    const rejected = userMessage("rejected", "rejected input");
    await memory.add(rejected);
    await memory.clear();

    await rollback.rollback(new Set([rejected]));

    assertEquals(await memory.getMessages(), []);
  });

  it("removes a rejected summary-memory write added after a concurrent clear", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 4 });
    await memory.add(userMessage("history", "accepted history"));
    const rollback = captureMemoryRollback(memory, await memory.getMessages());
    await memory.clear();
    const rejected = userMessage("rejected", "rejected input");
    await memory.add(rejected);

    await rollback.rollback(new Set([rejected]));

    assertEquals(await memory.getMessages(), []);
  });

  it("does not replay an in-flight summarized addition from its snapshot", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    await memory.add(userMessage("history-1", "first"));
    await memory.add(userMessage("history-2", "second"));
    const concurrent = userMessage("assistant", "concurrent output");
    const addition = memory.add(concurrent);
    const rollback = captureMemoryRollback(memory, []);
    await addition;
    const rejected = userMessage("rejected", "rejected input");
    await memory.add(rejected);

    await rollback.rollback(new Set([rejected]));

    assertEquals(
      (await memory.getMessages()).filter((message) => message.id === "assistant").length,
      1,
    );
  });
});
