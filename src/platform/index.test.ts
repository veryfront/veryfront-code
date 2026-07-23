import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CommandOptions, ServeOptions } from "./index.ts";

function importIndex(): Promise<typeof import("./index.ts")> {
  return import("./index.ts");
}

describe("platform/index.ts exports", () => {
  describe("adapters re-exports", () => {
    it("should export runtime", async () => {
      const { runtime } = await importIndex();
      assertExists(runtime);
    });

    it("should export createFSAdapter", async () => {
      const { createFSAdapter } = await importIndex();
      assertExists(createFSAdapter);
      assertEquals(typeof createFSAdapter, "function");
    });

    it("should export VeryfrontFSAdapter", async () => {
      const { VeryfrontFSAdapter } = await importIndex();
      assertExists(VeryfrontFSAdapter);
      assertEquals(typeof VeryfrontFSAdapter, "function");
    });

    it("should export VeryfrontApiClient", async () => {
      const { VeryfrontApiClient } = await importIndex();
      assertExists(VeryfrontApiClient);
      assertEquals(typeof VeryfrontApiClient, "function");
    });

    it("should export API request and release asset limits", async () => {
      const {
        DEFAULT_VERYFRONT_API_REQUEST_POLICY,
        RELEASE_ASSET_MAX_SIZE_BYTES,
      } = await importIndex();
      assertEquals(DEFAULT_VERYFRONT_API_REQUEST_POLICY.timeoutMs, 30_000);
      assertEquals(DEFAULT_VERYFRONT_API_REQUEST_POLICY.totalTimeoutMs, 120_000);
      assertEquals(DEFAULT_VERYFRONT_API_REQUEST_POLICY.maxResponseBytes, 64 * 1024 * 1024);
      assertEquals(RELEASE_ASSET_MAX_SIZE_BYTES, 10 * 1024 * 1024);
    });
  });

  describe("compat re-exports", () => {
    it("exposes the bounded command and server option types", () => {
      const commandOptions: CommandOptions = { capture: true, maxOutputBytes: 1_024 };
      const serveOptions: ServeOptions = { gracefulShutdownTimeoutMs: 5_000 };

      assertEquals(commandOptions.maxOutputBytes, 1_024);
      assertEquals(serveOptions.gracefulShutdownTimeoutMs, 5_000);
    });

    it("should export createKVStore", async () => {
      const { createKVStore } = await importIndex();
      assertExists(createKVStore);
      assertEquals(typeof createKVStore, "function");
    });

    it("should export MemoryKv", async () => {
      const { MemoryKv } = await importIndex();
      assertExists(MemoryKv);
      assertEquals(typeof MemoryKv, "function");
    });

    it("should export the portable KV limits", async () => {
      const { KV_PORTABLE_LIMITS } = await importIndex();
      assertEquals(KV_PORTABLE_LIMITS.maxKeyBytes, 2_048);
      assertEquals(KV_PORTABLE_LIMITS.maxValueBytes, 60 * 1_024);
    });

    it("should export the Deno KV compatibility installer", async () => {
      const { polyfillDenoKv } = await importIndex();
      assertEquals(typeof polyfillDenoKv, "function");
    });

    it("should export the DNS resolver", async () => {
      const { resolveHostAddresses } = await importIndex();
      assertEquals(typeof resolveHostAddresses, "function");
    });
  });
});
