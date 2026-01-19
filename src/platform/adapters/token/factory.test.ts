import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTokenStorageAdapter } from "./factory.ts";

describe("createTokenStorageAdapter", () => {
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

  it("should create MemoryTokenAdapter for memory type", async () => {
    const adapter = await createTokenStorageAdapter({ type: "memory" });
    assertExists(adapter);
  });

  it("should throw for unsupported type", async () => {
    await assertRejects(
      () => createTokenStorageAdapter({ type: "unsupported" as any }),
      Error,
      'Token storage adapter type "unsupported" is not implemented',
    );
  });
});
