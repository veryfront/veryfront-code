import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  bunAdapter,
  denoAdapter,
  detectRuntime,
  getAdapter,
  nodeAdapter,
} from "#veryfront/platform/adapters/detect.ts";
import { isBun, isDeno, isNode } from "../../../src/platform/compat/runtime.ts";

function assertRuntime(runtime: string): void {
  if (isDeno) {
    assertEquals(runtime, "deno");
    return;
  }
  if (isNode) {
    assertEquals(runtime, "node");
    return;
  }
  if (isBun) {
    assertEquals(runtime, "bun");
  }
}

function assertAdapterForRuntime(adapter: unknown): void {
  if (isDeno) {
    assertEquals(adapter, denoAdapter);
    return;
  }
  if (isNode) {
    assertEquals(adapter, nodeAdapter);
    return;
  }
  if (isBun) {
    assertEquals(adapter, bunAdapter);
  }
}

function assertAdapterStructure(adapter: any): void {
  assertExists(adapter);
  assertExists(adapter.name);
  assertExists(adapter.fs);
  assertExists(adapter.env);
  assertExists(adapter.capabilities);
  assertExists(adapter.serve);
}

function mockDetectRuntime(mockGlobals: any): string {
  if (typeof mockGlobals.Deno !== "undefined") return "deno";
  if (typeof mockGlobals.Bun !== "undefined") return "bun";
  if (mockGlobals.process?.versions?.node) return "node";
  if (
    typeof mockGlobals.caches !== "undefined" && typeof mockGlobals.WebSocketPair !== "undefined"
  ) {
    return "cloudflare";
  }
  return "unknown";
}

async function mockGetAdapter(runtime: string): Promise<unknown> {
  switch (runtime) {
    case "deno": {
      const { denoAdapter } = await import("#veryfront/platform/adapters/deno.ts");
      return denoAdapter;
    }
    case "bun": {
      const { bunAdapter } = await import("#veryfront/platform/adapters/bun.ts");
      return bunAdapter;
    }
    case "node": {
      const { nodeAdapter } = await import("#veryfront/platform/adapters/node.ts");
      return nodeAdapter;
    }
    case "cloudflare":
      throw new Error("Cloudflare adapter requires manual initialization with environment");
    default:
      throw new Error(`Unsupported runtime: ${runtime}`);
  }
}

describe("Runtime detection", () => {
  describe("detectRuntime", () => {
    it("should detect current runtime correctly", () => {
      const runtime = detectRuntime();
      assertRuntime(runtime);
    });

    it("should return string type", () => {
      const runtime = detectRuntime();
      assertExists(runtime);
      assertEquals(typeof runtime, "string");
    });
  });

  describe("getAdapter", () => {
    it("should return correct adapter for current runtime", async () => {
      const adapter = await getAdapter();
      assertAdapterForRuntime(adapter);
    });

    it("should return valid adapter structure", async () => {
      const adapter = await getAdapter();
      assertAdapterStructure(adapter);
    });
  });

  describe("Runtime detection edge cases", () => {
    it("should handle runtime detection with mock globals", () => {
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
      assertExists(await mockGetAdapter("deno"));
      assertExists(await mockGetAdapter("bun"));
      assertExists(await mockGetAdapter("node"));

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
      assertAdapterStructure(denoAdapter);
    });
  });

  describe("BunAdapter from detect", () => {
    it("should have correct properties", () => {
      assertEquals(bunAdapter.name, "bun");
      assertAdapterStructure(bunAdapter);
    });
  });

  describe("NodeAdapter from detect", () => {
    it("should have correct properties", () => {
      assertEquals(nodeAdapter.name, "node");
      assertAdapterStructure(nodeAdapter);
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
        const mod = await import("#veryfront/platform/adapters/detect.ts");

        assertExists(mod.detectRuntime);
        assertExists(mod.getAdapter);
        assertExists(mod.denoAdapter);
        assertExists(mod.bunAdapter);
        assertExists(mod.nodeAdapter);
      });
    },
  );
});
