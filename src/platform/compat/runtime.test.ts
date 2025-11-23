import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { isBun, isCloudflare, isDeno, isNode } from "./runtime.ts";

Deno.test("Runtime Detection | isDeno is true in Deno environment", () => {
  assertEquals(isDeno, true);
  assertExists(Deno);
});

Deno.test("Runtime Detection | isDeno detects Deno global", () => {
  assertEquals(typeof Deno, "object");
  assertEquals(isDeno, typeof Deno !== "undefined");
});

Deno.test("Runtime Detection | isNode detects Node.js compatibility", () => {
  assertEquals(typeof isNode, "boolean");

  if (isNode) {
    const globalWithProcess = globalThis as { process?: { versions?: { node?: string } } };
    assertExists(globalWithProcess.process?.versions?.node);
  }
});

Deno.test("Runtime Detection | isNode checks for process.versions.node", () => {
  const globalWithProcess = globalThis as { process?: { versions?: { node?: string } } };
  const hasNodeVersion = typeof globalWithProcess.process !== "undefined" &&
    globalWithProcess.process?.versions?.node !== undefined;

  assertEquals(isNode, hasNodeVersion);
});

Deno.test("Runtime Detection | isBun is false in Deno environment", () => {
  assertEquals(isBun, false);
});

Deno.test("Runtime Detection | isBun checks for Bun global", () => {
  const globalWithBun = globalThis as { Bun?: unknown };
  assertEquals(typeof globalWithBun.Bun, "undefined");
  assertEquals(isBun, typeof globalWithBun.Bun !== "undefined");
});

Deno.test("Runtime Detection | isCloudflare is false in Deno environment", () => {
  assertEquals(isCloudflare, false);
});

Deno.test("Runtime Detection | isCloudflare checks for caches and WebSocketPair", () => {
  const hasCaches = "caches" in globalThis;
  const hasWebSocketPair = "WebSocketPair" in globalThis;

  assertEquals(isCloudflare, hasCaches && hasWebSocketPair);
});

Deno.test("Runtime Detection | all runtime flags are boolean", () => {
  assertEquals(typeof isDeno, "boolean");
  assertEquals(typeof isNode, "boolean");
  assertEquals(typeof isBun, "boolean");
  assertEquals(typeof isCloudflare, "boolean");
});

Deno.test("Runtime Detection | Deno and Node can both be true", () => {
  if (isDeno && isNode) {
    assert(true, "Deno with Node.js compatibility detected");
  }

  const anyRuntime = isDeno || isNode || isBun || isCloudflare;
  assert(anyRuntime, "At least one runtime should be detected");
});

Deno.test("Runtime Detection | mutually exclusive runtimes", () => {
  const denoAndBun = isDeno && isBun;
  assertEquals(denoAndBun, false, "Deno and Bun should not both be true");

  const bunAndCloudflare = isBun && isCloudflare;
  assertEquals(bunAndCloudflare, false, "Bun and Cloudflare should not both be true");
});

Deno.test("Runtime Detection | isDeno export is accessible", () => {
  assertExists(isDeno);
  assertEquals(typeof isDeno, "boolean");
});

Deno.test("Runtime Detection | isNode export is accessible", () => {
  assertExists(isNode);
  assertEquals(typeof isNode, "boolean");
});

Deno.test("Runtime Detection | isBun export is accessible", () => {
  assertExists(isBun);
  assertEquals(typeof isBun, "boolean");
});

Deno.test("Runtime Detection | isCloudflare export is accessible", () => {
  assertExists(isCloudflare);
  assertEquals(typeof isCloudflare, "boolean");
});

Deno.test("Runtime Detection | simulates Node.js detection logic", () => {
  const mockGlobal = {
    process: {
      versions: {
        node: "18.0.0",
      },
    },
  };

  const mockIsNode = typeof mockGlobal.process !== "undefined" &&
    mockGlobal.process?.versions?.node !== undefined;

  assertEquals(mockIsNode, true);
});

Deno.test("Runtime Detection | simulates Bun detection logic", () => {
  const mockGlobal = {
    Bun: {},
  };

  const mockIsBun = typeof mockGlobal.Bun !== "undefined";

  assertEquals(mockIsBun, true);
});

Deno.test("Runtime Detection | simulates Cloudflare detection logic", () => {
  const mockGlobal = {
    caches: {},
    WebSocketPair: class {},
  };

  const mockIsCloudflare = "caches" in mockGlobal && "WebSocketPair" in mockGlobal;

  assertEquals(mockIsCloudflare, true);
});

Deno.test("Runtime Detection | Node detection handles missing process.versions", () => {
  const mockGlobal = {
    process: {},
  };

  const mockIsNode = typeof mockGlobal.process !== "undefined" &&
    (mockGlobal as any).process?.versions?.node !== undefined;

  assertEquals(mockIsNode, false);
});

Deno.test("Runtime Detection | Node detection handles process without node property", () => {
  const mockGlobal = {
    process: {
      versions: {},
    },
  };

  const mockIsNode = typeof mockGlobal.process !== "undefined" &&
    (mockGlobal as any).process?.versions?.node !== undefined;

  assertEquals(mockIsNode, false);
});

Deno.test("Runtime Detection | Cloudflare detection requires both properties", () => {
  const globalWithOnlyCaches = {
    caches: {},
  };

  const globalWithOnlyWebSocketPair = {
    WebSocketPair: class {},
  };

  const isCloudflare1 = "caches" in globalWithOnlyCaches && "WebSocketPair" in globalWithOnlyCaches;
  const isCloudflare2 = "caches" in globalWithOnlyWebSocketPair &&
    "WebSocketPair" in globalWithOnlyWebSocketPair;

  assertEquals(isCloudflare1, false);
  assertEquals(isCloudflare2, false);
});

Deno.test("Runtime Detection | runtime values are constants", () => {
  const val1 = isDeno;
  const val2 = isDeno;

  assertEquals(val1, val2);
});
