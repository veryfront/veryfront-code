import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
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

  it("createMemory still builds a stateful store directly", () => {
    assertInstanceOf(createMemory({ type: "conversation" }), ConversationMemory);
  });
});
