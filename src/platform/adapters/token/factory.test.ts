import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
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
