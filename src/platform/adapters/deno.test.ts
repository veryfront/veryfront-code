import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

describe("deno.ts exports", { skip: !isDeno }, () => {
  if (!isDeno) {
    it("skipped - not running in Deno", () => {});
    return;
  }

  async function importDenoModule(): Promise<typeof import("./deno.ts")> {
    return await import("./deno.ts");
  }

  it("should export DenoAdapter class", async () => {
    const { DenoAdapter } = await importDenoModule();
    assertExists(DenoAdapter);
    assertEquals(typeof DenoAdapter, "function");
  });

  describe("denoAdapter singleton", () => {
    it("should export denoAdapter instance", async () => {
      const { denoAdapter } = await importDenoModule();
      assertExists(denoAdapter);
    });

    it("should have correct id", async () => {
      const { denoAdapter } = await importDenoModule();
      assertEquals(denoAdapter.id, "deno");
    });

    it("should have correct name", async () => {
      const { denoAdapter } = await importDenoModule();
      assertEquals(denoAdapter.name, "deno");
    });

    it("should have fs adapter", async () => {
      const { denoAdapter } = await importDenoModule();
      assertExists(denoAdapter.fs);
      assertExists(denoAdapter.fs.readFile);
      assertExists(denoAdapter.fs.writeFile);
      assertExists(denoAdapter.fs.exists);
    });

    it("should have env adapter", async () => {
      const { denoAdapter } = await importDenoModule();
      assertExists(denoAdapter.env);
      assertExists(denoAdapter.env.get);
      assertExists(denoAdapter.env.set);
      assertExists(denoAdapter.env.toObject);
    });

    it("should have capabilities", async () => {
      const { denoAdapter } = await importDenoModule();
      assertExists(denoAdapter.capabilities);
      assertEquals(denoAdapter.capabilities.typescript, true);
      assertEquals(denoAdapter.capabilities.jsx, true);
    });

    it("should have serve method", async () => {
      const { denoAdapter } = await importDenoModule();
      assertExists(denoAdapter.serve);
      assertEquals(typeof denoAdapter.serve, "function");
    });

    it("should have server adapter", async () => {
      const { denoAdapter } = await importDenoModule();
      assertExists(denoAdapter.server);
      assertExists(denoAdapter.server.upgradeWebSocket);
    });
  });
});
