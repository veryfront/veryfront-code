import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  isBrowserEnvironment,
  isNode,
  isNodeRuntime,
  isServerEnvironment,
} from "#veryfront/platform/compat/runtime.ts";

// These cases mutate runtime globals (process, window, the SSR flag), which the
// unit boundary forbids, so they live here instead of next to runtime.ts.
describe("integration/runtime/compat/runtime-globals", () => {
  it("re-reads runtime globals at call time", () => {
    if (isNode) return;
    const original = Object.getOwnPropertyDescriptor(globalThis, "process");
    try {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        writable: true,
        value: { versions: { node: "22.0.0" } },
      });
      assertEquals(isNodeRuntime(), true, "isNodeRuntime re-reads globals at call time");
      assertEquals(
        isNode,
        false,
        "the module-load constant is unchanged, so the function is not an alias for it",
      );
    } finally {
      if (original) Object.defineProperty(globalThis, "process", original);
      else delete (globalThis as Record<string, unknown>).process;
    }
  });

  it("the SSR flag outranks a stubbed window", () => {
    const g = globalThis as Record<string, unknown>;
    try {
      g.window = { document: {} };
      assertEquals(isServerEnvironment(), false, "a stubbed window alone reads as browser");

      g.__VERYFRONT_SSR__ = true;
      assertEquals(isServerEnvironment(), true, "the SSR flag outranks a stubbed window");
      assertEquals(isBrowserEnvironment(), false, "isBrowserEnvironment is the exact inverse");
    } finally {
      delete g.window;
      delete g.__VERYFRONT_SSR__;
    }
  });
});
