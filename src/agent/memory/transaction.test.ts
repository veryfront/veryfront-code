import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import { registerTurnMessageValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import type { Memory, MemoryTransaction } from "./memory-interface.ts";

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
