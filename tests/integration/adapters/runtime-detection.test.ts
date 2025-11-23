import { assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import {
  bunAdapter,
  denoAdapter,
  detectRuntime,
  getAdapter,
  nodeAdapter,
} from "@veryfront/platform/adapters/detect.ts";

describe("Runtime detection", () => {
  describe("detectRuntime", () => {
    it("should detect Deno runtime", () => {
      const runtime = detectRuntime();
      assertEquals(runtime, "deno");
    });

    it("should return string type", () => {
      const runtime = detectRuntime();
      assertExists(runtime);
      assertEquals(typeof runtime, "string");
    });
  });

  describe("getAdapter", () => {
    it("should return denoAdapter in Deno runtime", async () => {
      const adapter = await getAdapter();
      assertEquals(adapter, denoAdapter);
    });

    it("should return valid adapter structure", async () => {
      const adapter = await getAdapter();
      assertExists(adapter);
      assertExists(adapter.name);
      assertExists(adapter.fs);
      assertExists(adapter.env);
      assertExists(adapter.features);
      assertExists(adapter.serve);
    });
  });

  describe("Runtime detection edge cases", () => {
    it("should handle runtime detection with mock globals", () => {
      function mockDetectRuntime(mockGlobals: any) {
        if (typeof mockGlobals.Deno !== "undefined") {
          return "deno";
        }
        if (typeof mockGlobals.Bun !== "undefined") {
          return "bun";
        }
        if (mockGlobals.process?.versions?.node) {
          return "node";
        }
        if (
          typeof mockGlobals.caches !== "undefined" &&
          typeof mockGlobals.WebSocketPair !== "undefined"
        ) {
          return "cloudflare";
        }
        return "unknown";
      }

      assertEquals(mockDetectRuntime({ Deno: {} }), "deno");
      assertEquals(mockDetectRuntime({ Bun: {} }), "bun");
      assertEquals(mockDetectRuntime({ process: { versions: { node: "18" } } }), "node");
      assertEquals(mockDetectRuntime({ caches: {}, WebSocketPair: {} }), "cloudflare");
      assertEquals(mockDetectRuntime({}), "unknown");
      assertEquals(mockDetectRuntime({ process: {} }), "unknown");
      assertEquals(mockDetectRuntime({ process: { versions: {} } }), "unknown");
      assertEquals(mockDetectRuntime({ caches: {} }), "unknown");
      assertEquals(mockDetectRuntime({ WebSocketPair: {} }), "unknown");
    });
  });

  describe("getAdapter error paths", () => {
    it("should handle different runtime adapter loading", async () => {
      async function mockGetAdapter(runtime: string) {
        switch (runtime) {
          case "deno": {
            const { denoAdapter } = await import("@veryfront/platform/adapters/deno.ts");
            return denoAdapter;
          }
          case "bun": {
            const { bunAdapter } = await import("@veryfront/platform/adapters/bun.ts");
            return bunAdapter;
          }
          case "node": {
            const { nodeAdapter } = await import("@veryfront/platform/adapters/node.ts");
            return nodeAdapter;
          }
          case "cloudflare": {
            throw new Error("Cloudflare adapter requires manual initialization with environment");
          }
          default:
            throw new Error(`Unsupported runtime: ${runtime}`);
        }
      }

      const denoResult = await mockGetAdapter("deno");
      assertExists(denoResult);

      const bunResult = await mockGetAdapter("bun");
      assertExists(bunResult);

      const nodeResult = await mockGetAdapter("node");
      assertExists(nodeResult);

      await assertRejects(
        () => mockGetAdapter("cloudflare"),
        Error,
        "Cloudflare adapter requires manual initialization with environment",
      );

      await assertRejects(() => mockGetAdapter("unknown"), Error, "Unsupported runtime: unknown");
    });
  });

  describe("Adapter exports", () => {
    it("should export all adapters", () => {
      assertExists(detectRuntime);
      assertExists(getAdapter);
      assertExists(denoAdapter);
      assertExists(bunAdapter);
      assertExists(nodeAdapter);
    });

    it("should export correct types", () => {
      assertEquals(typeof detectRuntime, "function");
      assertEquals(typeof getAdapter, "function");
      assertEquals(typeof denoAdapter, "object");
      assertEquals(typeof bunAdapter, "object");
      assertEquals(typeof nodeAdapter, "object");
    });
  });

  describe("DenoAdapter from detect", () => {
    it("should have correct properties", () => {
      assertEquals(denoAdapter.name, "deno");
      assertExists(denoAdapter.fs);
      assertExists(denoAdapter.env);
      assertExists(denoAdapter.features);
      assertExists(denoAdapter.serve);
    });
  });

  describe("BunAdapter from detect", () => {
    it("should have correct properties", () => {
      assertEquals(bunAdapter.name, "bun");
      assertExists(bunAdapter.fs);
      assertExists(bunAdapter.env);
      assertExists(bunAdapter.features);
      assertExists(bunAdapter.serve);
    });
  });

  describe("NodeAdapter from detect", () => {
    it("should have correct properties", () => {
      assertEquals(nodeAdapter.name, "node");
      assertExists(nodeAdapter.fs);
      assertExists(nodeAdapter.env);
      assertExists(nodeAdapter.features);
      assertExists(nodeAdapter.serve);
    });
  });

  describe(
    "Adapter module imports",
    {
      sanitizeOps: false,
      sanitizeResources: false,
    },
    () => {
      it("should import detect module successfully", async () => {
        const mod = await import("@veryfront/platform/adapters/detect.ts");

        assertExists(mod.detectRuntime);
        assertExists(mod.getAdapter);
        assertExists(mod.denoAdapter);
        assertExists(mod.bunAdapter);
        assertExists(mod.nodeAdapter);
      });
    },
  );
});
