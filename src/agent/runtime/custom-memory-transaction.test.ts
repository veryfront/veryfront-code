import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message } from "#veryfront/agent/types.ts";
import type { Memory } from "#veryfront/agent/memory/memory-interface.ts";
import { captureMemoryRollback, ConversationMemory } from "#veryfront/agent/memory/memory.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { AgentRuntime } from "./index.ts";

describe("custom memory transaction boundary", () => {
  it("waits for backend setup and rolls back a failed asynchronous commit", async () => {
    const store = new ConversationMemory<Message>({ type: "conversation" });
    const setupEntered = Promise.withResolvers<void>();
    const releaseSetup = Promise.withResolvers<void>();
    let providerCalls = 0;
    let rolledBack = false;
    const model: ModelRuntime = {
      provider: "openai",
      modelId: "veryfront-cloud/openai/custom-memory-transaction",
      async doGenerate() {
        providerCalls++;
        return {
          content: [{ type: "text", text: "answer" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        throw new Error("Expected generate");
      },
    };
    const runtime = new AgentRuntime("custom-memory", {
      model: model.modelId,
      system: "Helpful",
      maxSteps: 1,
      middleware: [securityMiddleware({})],
    }, { resolveModelRuntime: () => model });
    const memory: Memory<Message> = {
      add: store.add.bind(store),
      getMessages: store.getMessages.bind(store),
      clear: store.clear.bind(store),
      getStats: store.getStats.bind(store),
      async beginInputTransaction() {
        setupEntered.resolve();
        await releaseSetup.promise;
        const transaction = await captureMemoryRollback(store, []);
        return {
          async commit() {
            throw new Error("backend commit failed");
          },
          async rollback(rejected) {
            rolledBack = true;
            await transaction.rollback(rejected);
          },
        };
      },
    };
    // The runtime has no public custom-memory constructor option. Install a
    // structural Memory adapter here to exercise its adapter boundary.
    (runtime as unknown as { memory: Memory<Message> }).memory = memory;
    const failed = assertRejects(
      () => runtime.generate("caller input"),
      Error,
      "backend commit failed",
    );
    await setupEntered.promise;
    assertEquals((await store.getStats()).totalMessages, 0);
    assertEquals(providerCalls, 0);
    releaseSetup.resolve();
    await failed;
    assertEquals(rolledBack, true);
    assertEquals((await store.getMessages()).some((message) => message.role === "user"), false);
  });
});
