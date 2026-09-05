import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import {
  registerTurnMessageValidator,
  registerTurnProviderRequestValidator,
} from "#veryfront/agent/middleware/turn-validation.ts";
import type { Memory, MemoryTransaction } from "./memory-interface.ts";
import {
  beginMemoryTransaction,
  BufferMemory,
  ConversationMemory,
  SummaryMemory,
} from "./memory.ts";

const message = (id: string): Message => ({
  id,
  role: "user",
  parts: [{ type: "text", text: id }],
});

/** Versioned test backend. Its synchronous commit is the atomic storage boundary. */
class TransactionMemory implements Memory<Message> {
  stored: Message[] = [message("history")];
  version = 0;
  rollbacks = 0;
  failAdd = false;
  failRollback = false;
  add(value: Message): Promise<void> {
    this.stored.push(value);
    this.version++;
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.stored = [];
    this.version++;
    return Promise.resolve();
  }
  getMessages(): Promise<Message[]> {
    return Promise.resolve([...this.stored]);
  }
  getStats() {
    return Promise.resolve({
      totalMessages: this.stored.length,
      estimatedTokens: 0,
      type: "custom",
    });
  }
  beginTransaction(): Promise<MemoryTransaction<Message>> {
    const version = this.version;
    let staged = [...this.stored];
    let done = false;
    return Promise.resolve({
      add: (value) => {
        staged.push(value);
        return this.failAdd ? Promise.reject(new Error("staged write failed")) : Promise.resolve();
      },
      getMessages: () => Promise.resolve([...staged]),
      commit: () => {
        if (done) return Promise.resolve();
        if (version !== this.version) return Promise.reject(new Error("transaction conflict"));
        this.stored = staged;
        this.version++;
        done = true;
        return Promise.resolve();
      },
      rollback: () => {
        this.rollbacks++;
        if (this.failRollback) return Promise.reject(new Error("rollback failed"));
        staged = [];
        done = true;
        return Promise.resolve();
      },
    });
  }
}

type Prepared = {
  messages: Message[];
  commit(): Promise<void>;
  rollback(): Promise<void>;
  finalized: Promise<void>;
};
function prepare(memory: Memory<Message>, validate = true) {
  const runtime = new AgentRuntime("transaction-test", {
    model: "openai/gpt-4.1",
    system: "You are helpful.",
  });
  Reflect.set(runtime, "memory", memory);
  const context: AgentContext = {
    agentId: "transaction-test",
    input: "hello",
    model: "openai/gpt-4.1",
    data: {},
    platform: {},
  };
  if (validate) registerTurnMessageValidator(context, () => Promise.resolve());
  const run = Reflect.get(runtime, "prepareTurnMessages") as (
    input: Message[],
    context: AgentContext,
  ) => Promise<Prepared>;
  return () => run.call(runtime, [message("attempted")], context);
}

describe("custom memory transactions", () => {
  for (const Store of [ConversationMemory, BufferMemory, SummaryMemory]) {
    for (const operation of ["clear", "add", "duplicate"] as const) {
      it(`rejects ${Store.name} commit after concurrent ${operation}`, async () => {
        const store = new Store<Message>({ type: "conversation", maxMessages: 100 });
        const history = message("history");
        const input = message("input");
        const external = operation === "duplicate" ? input : message("external");
        await store.add(history);
        const transaction = await beginMemoryTransaction(store);
        await transaction.add(input);
        if (operation === "clear") await store.clear();
        await store.add(external);
        await transaction.add({ ...message("output"), role: "assistant" });
        await assertRejects(
          async () => {
            await transaction.commit();
          },
          Error,
          "concurrent",
        );
        await transaction.rollback();
        assertEquals(
          await store.getMessages(),
          operation === "clear" ? [external] : [history, external],
        );
      });
    }
  }
  it("serializes built-in turns until rollback can no longer restore rejected input", async () => {
    const store = new ConversationMemory<Message>({ type: "conversation" });
    const runtime = new AgentRuntime("transaction-concurrency", {
      model: "openai/gpt-4.1",
      system: "You are helpful.",
    });
    Reflect.set(runtime, "memory", store);
    const create = Reflect.get(runtime, "createTurnPersistence") as (
      messages: Message[],
      context: AgentContext,
    ) => {
      persist(): Promise<Message[]>;
      validateProviderRequest(system: string, messages: Message[]): Promise<void>;
    };
    const turns = ["first", "second"].map((id) => {
      const context: AgentContext = {
        agentId: "transaction-concurrency",
        input: [message(id)],
        platform: {},
      };
      registerTurnProviderRequestValidator(
        context,
        (system) =>
          system === "rejected" ? Promise.reject(new Error("rejected turn")) : Promise.resolve(),
      );
      return create.call(runtime, context.input as Message[], context);
    });
    const [firstTurn, secondTurn] = turns;
    assertExists(firstTurn);
    assertExists(secondTurn);
    const firstMessages = await firstTurn.persist();
    await firstTurn.validateProviderRequest("accepted", firstMessages);
    let secondPrepared = false;
    const second = secondTurn.persist().then((messages) => {
      secondPrepared = true;
      return messages;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(secondPrepared, false);
    await assertRejects(
      () => firstTurn.validateProviderRequest("rejected", firstMessages),
      Error,
      "rejected turn",
    );
    const secondMessages = await second;
    assertEquals(secondMessages.map(({ id }) => id), ["second"]);
    await assertRejects(
      () => secondTurn.validateProviderRequest("rejected", secondMessages),
      Error,
      "rejected turn",
    );
    assertEquals(await store.getMessages(), []);
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`rejects cyclic stateful ${mode} calls without poisoning later turns`, async () => {
      let delegate = true;
      const runtimes: AgentRuntime[] = [];
      for (let index = 0; index < 2; index++) {
        const invoke = async () => {
          if (delegate) await runtimes[1 - index]!.generate("delegated input");
        };
        runtimes.push(
          new AgentRuntime(`cycle-${index}`, {
            model: "hosted/transaction-cycle",
            system: "You are helpful.",
            memory: { type: "conversation" },
            skills: false,
            maxSteps: 1,
            middleware: [(context, next) => {
              registerTurnMessageValidator(context, () => Promise.resolve());
              return next();
            }],
            resolveModelTransport: () =>
              Promise.resolve({
                model: {
                  provider: "hosted",
                  modelId: "hosted/transaction-cycle",
                  async doGenerate() {
                    await invoke();
                    return {
                      content: [{ type: "text" as const, text: "ok" }],
                      finishReason: "stop" as const,
                      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    };
                  },
                  async doStream() {
                    await invoke();
                    return {
                      stream: new ReadableStream({
                        start(controller) {
                          controller.enqueue({ type: "text-delta", text: "ok" });
                          controller.enqueue({ type: "finish" });
                          controller.close();
                        },
                      }),
                    };
                  },
                },
              }),
          }),
        );
      }
      const runtime = runtimes[0]!;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Stateful delegation deadlocked")), 1000);
      });
      try {
        if (mode === "generate") {
          await assertRejects(
            () => Promise.race([runtime.generate("initial input"), timedOut]),
            Error,
            "cyclic",
          );
        } else {
          const output = await Promise.race([
            runtime.stream([message("initial")]).then((stream) => new Response(stream).text()),
            timedOut,
          ]);
          assertStringIncludes(output, "cyclic");
        }
        delegate = false;
        const response = await Promise.race([runtime.generate("next input"), timedOut]);
        assertEquals(response.text, "ok");
      } finally {
        clearTimeout(timeout);
      }
    });

    it(`commits input and assistant output together for ${mode}`, async () => {
      const store = new TransactionMemory();
      const runtime = new AgentRuntime("transaction-output", {
        model: "hosted/transaction-output",
        system: "You are helpful.",
        skills: false,
        maxSteps: 1,
        middleware: [(context, next) => {
          registerTurnMessageValidator(context, () => Promise.resolve());
          return next();
        }],
        resolveModelTransport: () =>
          Promise.resolve({
            model: {
              provider: "hosted",
              modelId: "hosted/transaction-output",
              doGenerate() {
                assertEquals(store.version, 0);
                return Promise.resolve({
                  content: [{ type: "text" as const, text: "ok" }],
                  finishReason: "stop" as const,
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                });
              },
              doStream() {
                assertEquals(store.version, 0);
                return Promise.resolve({
                  stream: new ReadableStream({
                    start(controller) {
                      controller.enqueue({ type: "text-delta", text: "ok" });
                      controller.enqueue({ type: "finish" });
                      controller.close();
                    },
                  }),
                });
              },
            },
          }),
      });
      Reflect.set(runtime, "memory", store);
      if (mode === "generate") {
        assertEquals((await runtime.generate([message("attempted")])).text, "ok");
      } else {
        const output = await new Response(await runtime.stream([message("attempted")])).text();
        assertStringIncludes(output, "message-finish");
      }
      assertEquals(store.stored.map(({ role }) => role), ["user", "user", "assistant"]);
      assertEquals(store.version, 1);
    });
  }

  it("finishes stream and replay cleanup when rollback fails", async () => {
    const store = new TransactionMemory();
    store.failRollback = true;
    let replayFailures = 0;
    const runtime = new AgentRuntime("transaction-stream", {
      model: "hosted/transaction-stream",
      system: "You are helpful.",
      middleware: [(context, next) => {
        registerTurnMessageValidator(context, () => Promise.resolve());
        return next();
      }],
      resolveRuntimeState: () => {
        throw new Error("runtime state failed");
      },
      resolveModelTransport: () =>
        Promise.resolve({
          model: {
            provider: "hosted",
            modelId: "hosted/transaction-stream",
            async doGenerate() {
              throw new Error("Unexpected dispatch");
            },
            async doStream() {
              throw new Error("Unexpected dispatch");
            },
          },
        }),
      ...{
        __vfProviderReplayCheckpointTurnFailed: () => {
          replayFailures++;
        },
      },
    });
    Reflect.set(runtime, "memory", store);
    const stream = await runtime.stream([message("attempted")]);
    const output = await new Response(stream).text();
    assertStringIncludes(output, "rollback failed");
    assertEquals(replayFailures, 1);
    assertEquals(Reflect.get(runtime, "status"), "error");
  });

  it("keeps rollback available when a later provider validation rejects", async () => {
    const store = new TransactionMemory();
    const runtime = new AgentRuntime("transaction-test", {
      model: "openai/gpt-4.1",
      system: "You are helpful.",
    });
    Reflect.set(runtime, "memory", store);
    const context: AgentContext = {
      agentId: "transaction-test",
      input: [message("attempted")],
      model: "openai/gpt-4.1",
      data: {},
      platform: {},
    };
    registerTurnProviderRequestValidator(context, (system) => {
      if (system === "rejected") return Promise.reject(new Error("later validation rejected"));
      return Promise.resolve();
    });
    const create = Reflect.get(runtime, "createTurnPersistence") as (
      messages: Message[],
      context: AgentContext,
    ) => {
      persist(): Promise<Message[]>;
      finalize(): Promise<void>;
      validateProviderRequest(system: string, messages: Message[]): Promise<void>;
    };
    const persistence = create.call(runtime, context.input as Message[], context);
    const messages = await persistence.persist();
    await persistence.validateProviderRequest("accepted", messages);
    await assertRejects(
      () => persistence.validateProviderRequest("rejected", messages),
      Error,
      "later validation rejected",
    );
    await persistence.finalize();
    assertEquals(store.stored.map((value) => value.id), ["history"]);
    assertEquals(store.rollbacks, 1);
  });

  it("shares pending commits and rejects retries after a commit conflict", async () => {
    const store = new TransactionMemory();
    const gate = Promise.withResolvers<void>();
    const begin = store.beginTransaction.bind(store);
    store.beginTransaction = async () => {
      const transaction = await begin();
      return {
        ...transaction,
        commit: async () => {
          await gate.promise;
          await transaction.commit();
        },
      };
    };
    const runtime = new AgentRuntime("transaction-test", {
      model: "openai/gpt-4.1",
      system: "You are helpful.",
    });
    Reflect.set(runtime, "memory", store);
    const context: AgentContext = {
      agentId: "transaction-test",
      input: "hello",
      model: "openai/gpt-4.1",
      data: {},
      platform: {},
    };
    registerTurnMessageValidator(context, () => Promise.resolve());
    const create = Reflect.get(runtime, "createTurnPersistence") as (
      messages: Message[],
      context: AgentContext,
    ) => {
      persist(): Promise<Message[]>;
      commit(): Promise<void>;
      finalize(): Promise<void>;
      validateProviderRequest(system: string, messages: Message[]): Promise<void>;
    };
    const persistence = create.call(runtime, [message("attempted")], context);
    await persistence.persist();
    const first = persistence.commit();
    let secondSettled = false;
    const second = persistence.commit().finally(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(secondSettled, false);
    await store.clear();
    const firstRejected = assertRejects(() => first, Error, "transaction conflict");
    const secondRejected = assertRejects(() => second, Error, "transaction conflict");
    gate.resolve();
    await Promise.all([firstRejected, secondRejected]);
    await persistence.finalize();
    await assertRejects(() => persistence.persist(), Error, "transaction conflict");
    await assertRejects(
      () => persistence.validateProviderRequest("system", []),
      Error,
      "transaction conflict",
    );
    assertEquals(store.stored, []);
  });
  it("rejects unsupported memory before writes", async () => {
    const store = new TransactionMemory();
    const memory: Memory<Message> = {
      add: (value) => store.add(value),
      clear: () => store.clear(),
      getMessages: () => store.getMessages(),
      getStats: () => store.getStats(),
    };
    await assertRejects(prepare(memory), Error, "beginTransaction()");
    assertEquals(store.version, 0);
  });
  it("preserves non-transactional use without validators", async () => {
    const store = new TransactionMemory();
    const memory: Memory<Message> = {
      add: (value) => store.add(value),
      clear: () => store.clear(),
      getMessages: () => store.getMessages(),
      getStats: () => store.getStats(),
    };
    const prepared = await prepare(memory, false)();
    await prepared.commit();
    assertEquals(store.stored.map((value) => value.id), ["history", "attempted"]);
  });
  it("stages input until commit and finalizes only after commit", async () => {
    const store = new TransactionMemory();
    const prepared = await prepare(store)();
    assertEquals(store.stored.map((value) => value.id), ["history"]);
    assertEquals(prepared.messages.map((value) => value.id), ["history", "attempted"]);
    await prepared.commit();
    await prepared.finalized;
    assertEquals(store.stored.map((value) => value.id), ["history", "attempted"]);
  });
  for (const operation of ["clear", "add"] as const) {
    it(`preserves concurrent ${operation} during rollback`, async () => {
      const store = new TransactionMemory();
      const prepared = await prepare(store)();
      if (operation === "clear") await store.clear();
      else await store.add(message("concurrent"));
      const expected = await store.getMessages();
      await prepared.rollback();
      assertEquals(store.stored, expected);
    });
    it(`rejects commit after concurrent ${operation} without overwriting history`, async () => {
      const store = new TransactionMemory();
      const prepared = await prepare(store)();
      if (operation === "clear") await store.clear();
      else await store.add(message("concurrent"));
      const expected = await store.getMessages();
      await assertRejects(() => prepared.commit(), Error, "transaction conflict");
      await prepared.finalized;
      assertEquals(store.stored, expected);
      assertEquals(store.rollbacks, 1);
    });
  }
  it("rolls back a write that fails after staging input", async () => {
    const store = new TransactionMemory();
    store.failAdd = true;
    await assertRejects(prepare(store), Error, "staged write failed");
    assertEquals(store.stored.map((value) => value.id), ["history"]);
    assertEquals(store.rollbacks, 1);
  });
  it("surfaces rollback failures and releases runtime finalization", async () => {
    const store = new TransactionMemory();
    const prepared = await prepare(store)();
    store.failRollback = true;
    await assertRejects(() => prepared.rollback(), Error, "rollback failed");
    await prepared.finalized;
    assertEquals(store.stored.map((value) => value.id), ["history"]);
  });
});
