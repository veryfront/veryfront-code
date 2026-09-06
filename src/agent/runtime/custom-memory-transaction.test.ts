import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentMiddleware, Message } from "#veryfront/agent/types.ts";
import type { Memory } from "#veryfront/agent/memory/memory-interface.ts";
import { beginMemoryTransaction, ConversationMemory } from "#veryfront/agent/memory/memory.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import {
  registerTurnMessageProjectionValidator,
  registerTurnMessageValidator,
} from "#veryfront/agent/middleware/turn-validation.ts";

describe("custom memory transaction boundary", () => {
  it("validates a reordered replacement as a projection and rolls it back", async () => {
    const retained: Message = {
      id: "retained",
      role: "system",
      parts: [{ type: "text", text: "den" }],
    };
    const store = new ConversationMemory<Message>({ type: "conversation" });
    await store.add(retained);
    let commits = 0;
    let rollbacks = 0;
    let providerCalls = 0;
    let turnValidatorCalls = 0;
    let projectionValidatorCalls = 0;
    const recorder: AgentMiddleware = (context, next) => {
      registerTurnMessageValidator(context, () => {
        turnValidatorCalls += 1;
        return Promise.resolve();
      });
      registerTurnMessageProjectionValidator(context, (messages, previousMessages) => {
        projectionValidatorCalls += 1;
        assertEquals(messages.map(({ id }) => id), ["current", "retained"]);
        assertEquals(previousMessages?.map(({ id }) => id), ["retained", "current"]);
        return Promise.resolve();
      });
      return next();
    };
    const model: ModelRuntime = {
      provider: "openai",
      modelId: "veryfront-cloud/openai/reordered-projection",
      doGenerate() {
        providerCalls += 1;
        return Promise.reject(new Error("Unsafe projection reached provider"));
      },
      doStream: () => Promise.reject(new Error("Expected generate")),
    };
    const runtime = new AgentRuntime("reordered-projection", {
      model: model.modelId,
      system: "Helpful",
      maxSteps: 1,
      security: false,
      middleware: [
        recorder,
        securityMiddleware({ input: { blockedPatterns: [/forbidden/] } }),
      ],
    }, { resolveModelRuntime: () => model });
    const memory: Memory<Message> = {
      add: store.add.bind(store),
      getMessages: store.getMessages.bind(store),
      clear: store.clear.bind(store),
      getStats: store.getStats.bind(store),
      async beginTransaction() {
        const staged = structuredClone(await store.getMessages());
        return {
          add(message) {
            staged.push(message);
            return Promise.resolve();
          },
          getMessages() {
            return Promise.resolve(structuredClone(staged).reverse());
          },
          commit() {
            commits += 1;
            return Promise.resolve();
          },
          rollback() {
            rollbacks += 1;
            return Promise.resolve();
          },
        };
      },
    };
    Reflect.set(runtime, "memory", memory);

    await assertRejects(
      () =>
        runtime.generate([{
          id: "current",
          role: "system",
          parts: [{ type: "text", text: "forbid" }],
        }]),
      Error,
      "Input validation failed",
    );

    assertEquals(turnValidatorCalls, 1);
    assertEquals(projectionValidatorCalls, 1);
    assertEquals(providerCalls, 0);
    assertEquals(commits, 0);
    assertEquals(rollbacks, 1);
    assertEquals(await store.getMessages(), [retained]);
  });

  it("preserves unchanged historical runs when a retaining adapter deserializes every read", async () => {
    const store = new ConversationMemory<Message>({ type: "conversation", maxMessages: 3 });
    for (
      const [id, role, text] of [
        ["older", "user", "older"],
        ["first", "system", "forbid"],
        ["second", "system", "den"],
      ] as const
    ) {
      await store.add({ id, role, parts: [{ type: "text", text }] });
    }
    const model: ModelRuntime = {
      provider: "openai",
      modelId: "veryfront-cloud/openai/deserialized-memory",
      doGenerate: () =>
        Promise.resolve({
          content: [{ type: "text" as const, text: "answer" }],
          finishReason: "stop" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      doStream: () => Promise.reject(new Error("Expected generate")),
    };
    const runtime = new AgentRuntime("deserialized-memory", {
      model: model.modelId,
      system: "Helpful",
      maxSteps: 1,
      middleware: [securityMiddleware({ input: { blockedPatterns: [/forbidden/] } })],
    }, { resolveModelRuntime: () => model });
    const memory: Memory<Message> = {
      add: store.add.bind(store),
      getMessages: async () => structuredClone(await store.getMessages()),
      clear: store.clear.bind(store),
      getStats: store.getStats.bind(store),
      async beginTransaction() {
        const transaction = await beginMemoryTransaction(store);
        return {
          add: transaction.add.bind(transaction),
          getMessages: async () => structuredClone(await transaction.getMessages()),
          commit: transaction.commit.bind(transaction),
          rollback: transaction.rollback.bind(transaction),
        };
      },
    };
    Reflect.set(runtime, "memory", memory);
    assertEquals((await runtime.generate("benign")).text, "answer");
  });

  it("rolls back output staged before an adapter add failure", async () => {
    const store = new ConversationMemory<Message>({ type: "conversation" });
    let commits = 0;
    let rollbacks = 0;
    const model: ModelRuntime = {
      provider: "openai",
      modelId: "veryfront-cloud/openai/custom-memory-transaction",
      async doGenerate() {
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
      middleware: [securityMiddleware({ input: { maxLength: 1000 } })],
    }, { resolveModelRuntime: () => model });
    const memory: Memory<Message> = {
      add: store.add.bind(store),
      getMessages: store.getMessages.bind(store),
      clear: store.clear.bind(store),
      getStats: store.getStats.bind(store),
      async beginTransaction() {
        let staged: Message[] = [];
        return {
          async add(message) {
            staged.push(message);
            if (message.role === "assistant") throw new Error("output staging failed");
          },
          getMessages: () => Promise.resolve(structuredClone(staged)),
          async commit() {
            commits++;
            for (const message of staged) await store.add(message);
          },
          async rollback() {
            rollbacks++;
            staged = [];
          },
        };
      },
    };
    Reflect.set(runtime, "memory", memory);
    await assertRejects(() => runtime.generate("caller input"), Error, "output staging failed");
    assertEquals(commits, 0);
    assertEquals(rollbacks, 1);
    assertEquals(await store.getMessages(), []);
  });

  for (const concurrent of ["unchanged", "add", "clear"] as const) {
    it(`waits for setup and preserves ${concurrent} history after failed commit`, async () => {
      const store = new ConversationMemory<Message>({ type: "conversation" });
      const history: Message = {
        id: "history",
        role: "user",
        parts: [{ type: "text", text: "accepted history" }],
        metadata: { optional: undefined },
      };
      const later: Message = {
        id: "history",
        role: "assistant",
        parts: [{ type: "text", text: "concurrent output" }],
      };
      await store.add(history);
      const setupEntered = Promise.withResolvers<void>();
      const releaseSetup = Promise.withResolvers<void>();
      let providerCalls = 0;
      let rolledBack = false;
      const model: ModelRuntime = {
        provider: "openai",
        modelId: "veryfront-cloud/openai/custom-memory-transaction",
        async doGenerate() {
          providerCalls++;
          if (concurrent === "clear") await store.clear();
          if (concurrent !== "unchanged") await store.add(later);
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
        middleware: [securityMiddleware({ input: { maxLength: 1000 } })],
      }, { resolveModelRuntime: () => model });
      const memory: Memory<Message> = {
        add: store.add.bind(store),
        getMessages: store.getMessages.bind(store),
        clear: store.clear.bind(store),
        getStats: store.getStats.bind(store),
        async beginTransaction() {
          setupEntered.resolve();
          await releaseSetup.promise;
          let staged = await store.getMessages();
          return {
            add(message) {
              staged.push(message);
              return Promise.resolve();
            },
            getMessages() {
              return Promise.resolve(structuredClone(staged));
            },
            async commit() {
              throw new Error("backend commit failed");
            },
            rollback() {
              rolledBack = true;
              staged = [];
              return Promise.resolve();
            },
          };
        },
      };
      // The runtime has no public custom-memory constructor option. Install a
      // structural Memory adapter here to exercise its adapter boundary.
      Reflect.set(runtime, "memory", memory);
      const failed = assertRejects(
        () => runtime.generate("caller input"),
        Error,
        "backend commit failed",
      );
      await setupEntered.promise;
      assertEquals((await store.getStats()).totalMessages, 1);
      assertEquals(providerCalls, 0);
      releaseSetup.resolve();
      await failed;
      assertEquals(rolledBack, true);
      assertEquals(
        await store.getMessages(),
        concurrent === "unchanged" ? [history] : concurrent === "add" ? [history, later] : [later],
      );
    });
  }
});
