import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BufferMemory,
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

  it("preserves a supplied Memory implementation", () => {
    const supplied = new NoMemory();
    assertStrictEquals(createAgentMemory(supplied), supplied);
  });

  it("rejects unsupported types and invalid limits instead of falling back", () => {
    assertThrows(
      () => createMemory({ type: "redis" }),
      Error,
      "createRedisMemory",
    );
    assertThrows(
      () => createAgentMemory({ type: "buffer", maxMessages: 0 }),
      Error,
      "maxMessages",
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

  it("reports stats including summary tokens and clears fully", async () => {
    const memory = new SummaryMemory({ type: "summary", maxMessages: 2 });
    for (let i = 1; i <= 6; i++) await memory.add(userMessage(String(i), `topic ${i}`));
    const stats = await memory.getStats();
    assertEquals(stats.type, "summary");
    assertEquals(stats.estimatedTokens > 0, true);

    await memory.clear();
    assertEquals(await memory.getMessages(), []);
  });
});
