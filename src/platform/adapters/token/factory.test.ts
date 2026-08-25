import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTokenStorageAdapter } from "./factory.ts";
import type { TokenStorageAdapterConfig } from "./veryfront/types.ts";

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

  it("should throw for unsupported type", async () => {
    await assertRejects(
      () => createTokenStorageAdapter({ type: "unsupported" as any }),
      Error,
      'Token storage adapter type "unsupported" is not implemented',
    );
  });

  it("rejects invalid Veryfront API retry config before initialization", async () => {
    await assertRejects(
      () =>
        createTokenStorageAdapter({
          type: "veryfront-api",
          veryfront: {
            apiToken: "test-token",
            projectSlug: "test-project",
            retry: { maxRetries: 10 },
          },
        }),
      RangeError,
      "maxRetries",
    );
  });

  it("validates the retry config captured at call time, not a later mutation", async () => {
    const options = {
      apiToken: "original-token",
      projectSlug: "test-project",
      retry: { maxRetries: 10 },
    };

    const pending = createTokenStorageAdapter({ type: "veryfront-api", veryfront: options });
    options.retry = { maxRetries: 0 };

    await assertRejects(
      () => pending,
      RangeError,
      "maxRetries",
      "the factory must reject the retry config it captured before its async body ran",
    );
  });

  it("reads credentials from the call-time options, not a later mutation", async () => {
    const options = { apiToken: "   ", projectSlug: "test-project" };

    const pending = createTokenStorageAdapter({ type: "veryfront-api", veryfront: options });
    options.apiToken = "repaired-token";

    await assertRejects(
      () => pending,
      Error,
      "requires apiToken",
      "a blank call-time apiToken must not be repaired by mutating the caller's object",
    );
  });

  it("should default to memory type when type not specified", async () => {
    const adapter = await createTokenStorageAdapter({} as TokenStorageAdapterConfig);
    assertExists(adapter);
    assertExists(adapter.get);
    assertExists(adapter.set);
    assertExists(adapter.delete);
  });

  it("rejects cloud options without the explicit cloud discriminator", async () => {
    await assertRejects(
      () =>
        createTokenStorageAdapter({
          veryfront: {
            apiToken: "test-token",
            projectSlug: "test-project",
          },
        } as unknown as TokenStorageAdapterConfig),
      Error,
      'requires adapter type "veryfront-api"',
    );
  });

  it("rejects cloud options combined with the memory discriminator", async () => {
    await assertRejects(
      () =>
        createTokenStorageAdapter({
          type: "memory",
          veryfront: {
            apiToken: "test-token",
            projectSlug: "test-project",
          },
        } as unknown as TokenStorageAdapterConfig),
      Error,
      'requires adapter type "veryfront-api"',
    );
  });

  it("should return a working memory adapter", async () => {
    const adapter = await createTokenStorageAdapter({ type: "memory" });
    await adapter.set("test-key", "test-value");
    assertEquals(await adapter.get("test-key"), "test-value");
    await adapter.delete("test-key");
    assertEquals(await adapter.get("test-key"), null);
  });
});
