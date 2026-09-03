import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  getEnv,
  getTrustedProjectEnvSnapshot,
  registerTrustedProjectEnvSnapshot,
} from "#veryfront/platform/compat/process/env.ts";
import {
  getProjectEnv,
  getProjectEnvSnapshot,
  getTrustedProjectEnvIdentity,
  isProjectEnvActive,
  runWithProjectEnv,
  runWithTrustedProjectEnv,
} from "./storage.ts";
import { AsyncLocalStorage } from "node:async_hooks";

describe("project-env/storage", () => {
  it("returns undefined outside any context", () => {
    assertEquals(getProjectEnv("FOO"), undefined);
  });

  it("returns value from active context", () => {
    runWithProjectEnv({ FOO: "bar" }, () => {
      assertEquals(getProjectEnv("FOO"), "bar");
    });
  });

  it("keeps runtime identity separate from project environment values", () => {
    runWithProjectEnv({ VERYFRONT_PROJECT_ID: "forged-project" }, () => {
      assertEquals(getTrustedProjectEnvIdentity(), undefined);
    });

    runWithTrustedProjectEnv(
      { VERYFRONT_PROJECT_ID: "forged-project" },
      { projectId: "trusted-project", environmentId: "trusted-environment" },
      () => {
        const identity = getTrustedProjectEnvIdentity();
        assertEquals(identity, {
          projectId: "trusted-project",
          environmentId: "trusted-environment",
        });
        assertEquals(Object.isFrozen(identity!), true);
      },
    );
  });

  it("uses context operations captured before project prototype mutation", () => {
    const originalDisable = Object.getOwnPropertyDescriptor(
      AsyncLocalStorage.prototype,
      "disable",
    )!;
    const originalEnterWith = Object.getOwnPropertyDescriptor(
      AsyncLocalStorage.prototype,
      "enterWith",
    )!;
    const originalRun = Object.getOwnPropertyDescriptor(AsyncLocalStorage.prototype, "run")!;
    const originalGetStore = Object.getOwnPropertyDescriptor(
      AsyncLocalStorage.prototype,
      "getStore",
    )!;
    let poisonedCalls = 0;
    const poison = () => {
      poisonedCalls += 1;
      throw new Error("project AsyncLocalStorage hook must not run");
    };
    Object.defineProperty(AsyncLocalStorage.prototype, "disable", {
      configurable: true,
      value: poison,
    });
    Object.defineProperty(AsyncLocalStorage.prototype, "enterWith", {
      configurable: true,
      value: poison,
    });
    Object.defineProperty(AsyncLocalStorage.prototype, "run", {
      configurable: true,
      value: poison,
    });
    Object.defineProperty(AsyncLocalStorage.prototype, "getStore", {
      configurable: true,
      value: poison,
    });

    try {
      runWithProjectEnv({ FOO: "captured" }, () => {
        assertEquals(getProjectEnv("FOO"), "captured");
        assertEquals(isProjectEnvActive(), true);
      });
    } finally {
      Object.defineProperty(AsyncLocalStorage.prototype, "disable", originalDisable);
      Object.defineProperty(AsyncLocalStorage.prototype, "enterWith", originalEnterWith);
      Object.defineProperty(AsyncLocalStorage.prototype, "run", originalRun);
      Object.defineProperty(AsyncLocalStorage.prototype, "getStore", originalGetStore);
    }
    assertEquals(poisonedCalls, 0);
  });

  it("returns undefined for keys not in the overlay", () => {
    runWithProjectEnv({ FOO: "bar" }, () => {
      assertEquals(getProjectEnv("MISSING"), undefined);
    });
  });

  it("nested context overrides parent", () => {
    runWithProjectEnv({ FOO: "outer" }, () => {
      assertEquals(getProjectEnv("FOO"), "outer");

      runWithProjectEnv({ FOO: "inner" }, () => {
        assertEquals(getProjectEnv("FOO"), "inner");
      });

      assertEquals(getProjectEnv("FOO"), "outer");
    });
  });

  it("isProjectEnvActive returns false outside context", () => {
    assertEquals(isProjectEnvActive(), false);
  });

  it("isProjectEnvActive returns true inside context", () => {
    runWithProjectEnv({ FOO: "bar" }, () => {
      assertEquals(isProjectEnvActive(), true);
    });
  });

  it("isProjectEnvActive returns true for empty overlay", () => {
    runWithProjectEnv({}, () => {
      assertEquals(isProjectEnvActive(), true);
    });
  });

  it("getProjectEnvSnapshot returns undefined outside context", () => {
    assertEquals(getProjectEnvSnapshot(), undefined);
  });

  it("getProjectEnvSnapshot returns full env overlay inside context", () => {
    const input = { FOO: "bar", BAZ: "qux" };
    runWithProjectEnv(input, () => {
      const snapshot = getProjectEnvSnapshot();
      assertEquals(snapshot, { FOO: "bar", BAZ: "qux" });
      assertEquals(Object.getPrototypeOf(snapshot!), null);
      assertEquals(Object.isFrozen(snapshot!), true);
      input.FOO = "mutated";
      assertEquals(getProjectEnv("FOO"), "bar");
    });
  });

  it("exposes the current snapshot to isolated route workers", () => {
    const getter = (globalThis as Record<string, unknown>).__vfProjectEnvSnapshotGetter;
    assertEquals(typeof getter, "function");

    runWithProjectEnv({ TENANT_SECRET: "scoped" }, () => {
      assertEquals((getter as () => unknown)(), { TENANT_SECRET: "scoped" });
    });
    assertEquals((getter as () => unknown)(), undefined);
  });

  it("rejects accessor-backed overlays without invoking getters", () => {
    let calls = 0;
    const input = Object.create(null);
    Object.defineProperty(input, "SECRET", {
      enumerable: true,
      get() {
        calls += 1;
        return "leaked";
      },
    });

    assertThrows(() => runWithProjectEnv(input, () => undefined), TypeError);
    assertEquals(calls, 0);
  });

  it("getProjectEnvSnapshot returns empty object for empty overlay", () => {
    runWithProjectEnv({}, () => {
      assertEquals(getProjectEnvSnapshot(), {});
    });
  });

  it("does not allow the trusted snapshot bridge to be replaced", () => {
    assertThrows(
      () => registerTrustedProjectEnvSnapshot(() => ({ FOO: "attacker" })),
      Error,
      "Project environment snapshot bridge is already registered",
    );

    const globals = globalThis as Record<string, unknown>;
    const previousLegacyGetter = globals.__vfProjectEnvGetter;
    const previousLegacyActiveChecker = globals.__vfProjectEnvActiveChecker;
    globals.__vfProjectEnvGetter = () => "legacy-replacement";
    globals.__vfProjectEnvActiveChecker = () => false;
    try {
      runWithProjectEnv({ FOO: "trusted" }, () => {
        assertEquals(getTrustedProjectEnvSnapshot(), { FOO: "trusted" });
        assertEquals(getEnv("FOO"), "trusted");
      });
    } finally {
      if (previousLegacyGetter === undefined) {
        delete globals.__vfProjectEnvGetter;
      } else {
        globals.__vfProjectEnvGetter = previousLegacyGetter;
      }
      if (previousLegacyActiveChecker === undefined) {
        delete globals.__vfProjectEnvActiveChecker;
      } else {
        globals.__vfProjectEnvActiveChecker = previousLegacyActiveChecker;
      }
    }
  });

  it("concurrent async contexts are isolated", async () => {
    const results: string[] = [];

    const task1 = new Promise<void>((resolve) => {
      runWithProjectEnv({ KEY: "task1" }, () => {
        setTimeout(() => {
          results.push(`task1:${getProjectEnv("KEY")}`);
          resolve();
        }, 10);
      });
    });

    const task2 = new Promise<void>((resolve) => {
      runWithProjectEnv({ KEY: "task2" }, () => {
        setTimeout(() => {
          results.push(`task2:${getProjectEnv("KEY")}`);
          resolve();
        }, 5);
      });
    });

    await Promise.all([task1, task2]);

    assertEquals(results.includes("task1:task1"), true);
    assertEquals(results.includes("task2:task2"), true);
  });
});
