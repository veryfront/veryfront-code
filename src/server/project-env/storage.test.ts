import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { getProjectEnv, isProjectEnvActive, runWithProjectEnv } from "./storage.ts";

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
