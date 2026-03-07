import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getAdapter } from "./detect.ts";
import type { RuntimeId } from "./base.ts";

function getExpectedRuntime(): RuntimeId {
  if (isDeno) return "deno";
  if (isNode) return "node";
  if (isBun) return "bun";
  return "deno";
}

const expectedRuntime = getExpectedRuntime();

describe("detect.ts", () => {
  describe("getAdapter", () => {
    it("should return a valid RuntimeAdapter", async () => {
      const adapter = await getAdapter();

      assertExists(adapter);
      assertExists(adapter.id);
      assertExists(adapter.name);
      assertExists(adapter.fs);
      assertExists(adapter.env);
      assertExists(adapter.capabilities);
      assertExists(adapter.serve);
    });

    it("should return adapter matching current runtime", async () => {
      const adapter = await getAdapter();
      assertEquals(adapter.id, expectedRuntime);
      assertEquals(adapter.name, expectedRuntime);
    });

    it("should return adapter with correct capabilities", async () => {
      const { capabilities } = await getAdapter();

      assertEquals(typeof capabilities.typescript, "boolean");
      assertEquals(typeof capabilities.jsx, "boolean");
      assertEquals(typeof capabilities.http2, "boolean");
      assertEquals(typeof capabilities.websocket, "boolean");
      assertEquals(typeof capabilities.workers, "boolean");
    });
  });

  describe("re-exports", () => {
    it("should export denoAdapter", async () => {
      const { denoAdapter } = await import("./detect.ts");
      assertExists(denoAdapter);
      assertEquals(denoAdapter.id, "deno");
    });

    it("should export nodeAdapter", async () => {
      const { nodeAdapter } = await import("./detect.ts");
      assertExists(nodeAdapter);
      assertEquals(nodeAdapter.id, "node");
    });

    it("should export bunAdapter", async () => {
      const { bunAdapter } = await import("./detect.ts");
      assertExists(bunAdapter);
      assertEquals(bunAdapter.id, "bun");
    });

    it("should export runtime registry", async () => {
      const { runtime } = await import("./detect.ts");
      assertExists(runtime);
      assertExists(runtime.get);
      assertExists(runtime.set);
    });
  });
});
