import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createTokenStorageAdapter } from "./factory.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

describe("createTokenStorageAdapter", () => {
  afterEach(() => {
    __resetLogRecordEmitterForTests();
  });

  it("should export createTokenStorageAdapter function", () => {
    assertExists(createTokenStorageAdapter);
    assertEquals(typeof createTokenStorageAdapter, "function");
  });

  it("should create MemoryTokenAdapter for memory type", async () => {
    const adapter = await createTokenStorageAdapter({ type: "memory" });
    assertExists(adapter);
    assertExists(adapter.get);
    assertExists(adapter.set);
    assertExists(adapter.delete);
  });

  it("rejects an unsupported type without exposing it", async () => {
    const secret = "PRIVATE_TYPE_CANARY";
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    const error = await createTokenStorageAdapter({ type: secret as never }).then(
      () => undefined,
      (reason) => reason as VeryfrontError,
    );

    assertExists(error);
    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(JSON.stringify({ entries, error }).includes(secret), false);
  });

  it("wraps unreadable and non-object configuration as a typed error", async () => {
    const secret = "PRIVATE_GETTER_CANARY";
    const unreadable = Object.defineProperty({}, "type", {
      get() {
        throw new Error(secret);
      },
    });

    for (const config of [unreadable, null]) {
      const error = await createTokenStorageAdapter(config as never).then(
        () => undefined,
        (reason) => reason as VeryfrontError,
      );
      assertExists(error);
      assertEquals(error instanceof VeryfrontError, true);
      assertEquals(JSON.stringify(error).includes(secret), false);
    }
  });

  it("should default to memory type when type not specified", async () => {
    const adapter = await createTokenStorageAdapter({});
    assertExists(adapter);
    assertExists(adapter.get);
    assertExists(adapter.set);
    assertExists(adapter.delete);
  });

  it("should return a working memory adapter", async () => {
    const adapter = await createTokenStorageAdapter({ type: "memory" });
    await adapter.set("test-key", "test-value");
    assertEquals(await adapter.get("test-key"), "test-value");
    await adapter.delete("test-key");
    assertEquals(await adapter.get("test-key"), null);
  });
});
