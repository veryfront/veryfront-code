import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_VERYFRONT_FILESYSTEM_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import { createFSAdapter } from "./factory.ts";

describe("createFSAdapter", () => {
  it("should export createFSAdapter function", () => {
    assertExists(createFSAdapter);
    assertEquals(typeof createFSAdapter, "function");
  });

  it("should throw for local type", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "local" }),
      Error,
      'FSAdapter type "local" should not use this factory',
    );
  });

  it("should throw for unsupported type", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "unsupported" as any }),
      Error,
      'FSAdapter type "unsupported" is not implemented',
    );
  });

  it("should throw for github type without config", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "github" }),
      Error,
      "GitHub adapter requires github configuration",
    );
  });

  it("should default to local type when type not specified", async () => {
    await assertRejects(
      () => createFSAdapter({}),
      Error,
      'FSAdapter type "local" should not use this factory',
    );
  });

  it("should throw for memory type (not implemented)", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "memory" as any }),
      Error,
      'FSAdapter type "memory" is not implemented',
    );
  });

  it("rejects invalid retry policies before constructing a lazy proxy adapter", async () => {
    await assertRejects(
      () =>
        createFSAdapter({
          type: "veryfront-api",
          veryfront: {
            proxyMode: true,
            retry: {
              maxRetries: MAX_VERYFRONT_FILESYSTEM_RETRIES + 1,
            },
          },
        }),
      RangeError,
      "maxRetries",
    );
  });
});
