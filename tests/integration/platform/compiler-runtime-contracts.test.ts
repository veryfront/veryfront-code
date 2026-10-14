import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isCloudflare, isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getV8HeapSizeLimit } from "#veryfront/platform/compat/process/lifecycle.ts";
import { createLifecycleRunEventAdapter } from "#veryfront/agent/conversation/lifecycle-run-event-adapter.ts";
import type { StreamLifecycleFrame } from "#veryfront/agent/streaming/lifecycle/index.ts";
function frames(
  entries: readonly {
    class?: StreamLifecycleFrame["class"];
    event: unknown;
  }[],
): StreamLifecycleFrame[] {
  return entries.map((entry, index) => ({
    class: entry.class ?? "semantic",
    event: entry.event,
    sequence: index + 1,
    elapsedMs: index,
  } as StreamLifecycleFrame));
}

describe("compiler runtime host contracts", () => {
  it("retains a positive fixed V8 heap ceiling on native Deno", () => {
    if (!isDeno) return;
    const limit = getV8HeapSizeLimit();
    assertExists(limit);
    assertEquals(Number.isFinite(limit) && limit > 0, true);
  });

  it("does not redirect the captured Deno compatibility lookup through a replaced global", () => {
    if (!isDeno) return;
    const previous = Object.getOwnPropertyDescriptor(globalThis, "process");
    let reads = 0;
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      get() {
        reads++;
        throw new Error("project process getter must not run");
      },
    });
    try {
      const limit = getV8HeapSizeLimit();
      assertExists(limit);
      assertEquals(Number.isFinite(limit) && limit > 0, true);
      assertEquals(reads, 0);
    } finally {
      if (previous) Object.defineProperty(globalThis, "process", previous);
      else Reflect.deleteProperty(globalThis, "process");
    }
  });

  it("does not initialize the Node global while detecting native Deno", async () => {
    if (!isDeno) return;
    const previous = Object.getOwnPropertyDescriptor(globalThis, "process");
    let reads = 0;
    let kind: string | undefined;
    let node: boolean | undefined;
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      get() {
        reads++;
        throw new Error("Node compatibility global must stay lazy");
      },
    });
    try {
      const isolated = await import("#veryfront/platform/compat/runtime.ts?native-deno-lazy-node");
      kind = isolated.runtimeKind;
      node = isolated.isNodeRuntime();
      const processModule = await import(
        "#veryfront/platform/compat/process/runtime-process.ts?native-deno-lazy-node"
      );
      assertEquals(processModule.runtimeProcess, null);
      assertEquals(processModule.hostProcessEnv, null);
    } finally {
      if (previous) Object.defineProperty(globalThis, "process", previous);
      else Reflect.deleteProperty(globalThis, "process");
    }
    assertEquals(kind, "deno");
    assertEquals(node, false);
    assertEquals(reads, 0);
  });

  it("retains Node precedence for Deno shims without invoking private accessors", async () => {
    const previousDeno = Object.getOwnPropertyDescriptor(globalThis, "Deno");
    const previousProcess = Object.getOwnPropertyDescriptor(globalThis, "process");
    const marker = Symbol("shim-marker");
    let reads = 0;
    for (
      const variant of [
        "plain",
        "marker-getter",
        "slot-getter",
        "copied-native-footprint",
        "node-lazy-accessor",
      ] as const
    ) {
      const shim = { version: {}, build: { os: "linux" } };
      if (variant === "marker-getter") {
        Object.defineProperty(shim, "internal", {
          get() {
            reads++;
            throw new Error("shim getter must not run");
          },
        });
      } else if (variant === "slot-getter") {
        Object.defineProperty(shim, "internal", { value: marker });
        Object.defineProperty(shim, marker, {
          get() {
            reads++;
            throw new Error("shim slot getter must not run");
          },
        });
      }
      if (variant === "copied-native-footprint" || variant === "node-lazy-accessor") {
        Object.defineProperty(shim, "internal", { value: marker });
        Object.defineProperty(shim, marker, { value: {} });
      }
      let kind: string | undefined;
      let node: boolean | undefined;
      Object.defineProperty(globalThis, "Deno", { configurable: true, value: shim });
      Object.defineProperty(
        globalThis,
        "process",
        variant === "node-lazy-accessor"
          ? {
            configurable: true,
            enumerable: false,
            get() {
              return { versions: { node: "24.0.0" } };
            },
          }
          : {
            configurable: true,
            value: { versions: { node: "24.0.0" } },
          },
      );
      try {
        const isolated = await import(`#veryfront/platform/compat/runtime.ts?node-shim-${variant}`);
        kind = isolated.runtimeKind;
        node = isolated.isNodeRuntime();
      } finally {
        if (previousDeno) Object.defineProperty(globalThis, "Deno", previousDeno);
        else Reflect.deleteProperty(globalThis, "Deno");
        if (previousProcess) Object.defineProperty(globalThis, "process", previousProcess);
        else Reflect.deleteProperty(globalThis, "process");
      }
      assertEquals(kind, isBun ? "bun" : isCloudflare ? "cloudflare" : "node");
      assertEquals(node, !isBun && !isCloudflare);
    }
    assertEquals(reads, 0);
  });

  it("cancels the exact native timer handle once on disposal", () => {
    const originalSet = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
    const originalClear = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout")!;
    const handle = Object.freeze({ nativeTimer: true });
    const cleared: unknown[] = [];
    let scheduled = 0;
    try {
      Object.defineProperty(globalThis, "setTimeout", {
        configurable: true,
        value: () => {
          scheduled++;
          return handle;
        },
      });
      Object.defineProperty(globalThis, "clearTimeout", {
        configurable: true,
        value: (value: unknown) => {
          cleared.push(value);
        },
      });
      const adapter = createLifecycleRunEventAdapter({
        runId: "run-1",
        attemptId: "attempt-1",
        attemptIndex: 0,
        messageId: "message-1",
        onEvents: () => {},
      });
      for (
        const frame of frames([
          { event: { type: "message_start" } },
          { event: { type: "text_start", id: "text:0" } },
          { event: { type: "text_content", id: "text:0", delta: "buffered" } },
        ])
      ) adapter.handleFrame(frame);
      adapter.dispose();
      adapter.dispose();
      assertEquals(scheduled, 1);
      assertEquals(cleared.length, 1);
      assertEquals(cleared[0] === handle, true);
    } finally {
      Object.defineProperty(globalThis, "setTimeout", originalSet);
      Object.defineProperty(globalThis, "clearTimeout", originalClear);
    }
  });
});
