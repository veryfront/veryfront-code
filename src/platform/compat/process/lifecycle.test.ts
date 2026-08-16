import "#veryfront/schemas/_test-setup.ts";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun } from "../runtime.ts";
import { getV8HeapSizeLimit } from "./lifecycle.ts";

describe("platform/compat/process/lifecycle", () => {
  it("uses Bun's synchronous builtin fallback for V8 heap statistics", () => {
    if (!isBun) return;

    const hostProcess = (globalThis as {
      process: { getBuiltinModule?: (specifier: string) => unknown };
    }).process;
    const descriptor = Object.getOwnPropertyDescriptor(hostProcess, "getBuiltinModule");

    try {
      Object.defineProperty(hostProcess, "getBuiltinModule", {
        configurable: true,
        value: undefined,
      });
      const limit = getV8HeapSizeLimit();
      assert(
        typeof limit === "number" && limit > 0,
        "Bun must read its heap limit when process.getBuiltinModule is unavailable",
      );
    } finally {
      if (descriptor) Object.defineProperty(hostProcess, "getBuiltinModule", descriptor);
      else delete hostProcess.getBuiltinModule;
    }
  });
});
