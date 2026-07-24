import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  getTrustedProjectEnvSnapshot,
  registerTrustedProjectEnvSnapshot,
} from "#veryfront/platform/compat/process/env.ts";
import {
  getProjectEnv,
  getProjectEnvSnapshot,
  isProjectEnvActive,
  runWithProjectEnv,
} from "./storage.ts";

describe("project-env/storage", () => {
  it("returns undefined outside any context", () => {
    assertEquals(getProjectEnv("FOO"), undefined);
  });

  it("returns value from active context", () => {
    runWithProjectEnv({ FOO: "bar" }, () => {
      assertEquals(getProjectEnv("FOO"), "bar");
    });
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
    runWithProjectEnv({ FOO: "bar", BAZ: "qux" }, () => {
      const snapshot = getProjectEnvSnapshot();
      assertEquals(snapshot, { FOO: "bar", BAZ: "qux" });
    });
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
    const previousLegacyGetter = globals.__vfProjectEnvSnapshotGetter;
    globals.__vfProjectEnvSnapshotGetter = () => ({ FOO: "legacy-attacker" });
    try {
      runWithProjectEnv({ FOO: "trusted" }, () => {
        assertEquals(getTrustedProjectEnvSnapshot(), { FOO: "trusted" });
      });
    } finally {
      if (previousLegacyGetter === undefined) {
        delete globals.__vfProjectEnvSnapshotGetter;
      } else {
        globals.__vfProjectEnvSnapshotGetter = previousLegacyGetter;
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
