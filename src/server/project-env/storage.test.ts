import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  getProjectEnv,
  getProjectEnvSnapshot,
  isProjectEnvActive,
  runWithProjectEnv,
} from "./storage.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";

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

  it("exposes project-scoped env through process.env without host fallthrough", () => {
    const hostKey = "__VF_PROJECT_ENV_HOST_ONLY__";
    const projectKey = "__VF_PROJECT_ENV_PROJECT_ONLY__";
    const originalHostValue = Deno.env.get(hostKey);
    Deno.env.set(hostKey, "host-secret");

    try {
      runWithProjectEnv({ [projectKey]: "project-token" }, () => {
        assertEquals(process.env[projectKey], "project-token");
        assertEquals(process.env[hostKey], undefined);
        assertEquals(getEnv(projectKey), "project-token");
        assertEquals(getEnv(hostKey), undefined);
        assertEquals(getHostEnv(hostKey), "host-secret");
      });
    } finally {
      if (originalHostValue === undefined) {
        Deno.env.delete(hostKey);
      } else {
        Deno.env.set(hostKey, originalHostValue);
      }
    }
  });

  it("keeps process.env isolated across concurrent project env contexts", async () => {
    const results: string[] = [];

    const task1 = new Promise<void>((resolve) => {
      runWithProjectEnv({ VERYFRONT_API_TOKEN: "run-token-1" }, () => {
        setTimeout(() => {
          results.push(`task1:${process.env.VERYFRONT_API_TOKEN}`);
          resolve();
        }, 10);
      });
    });

    const task2 = new Promise<void>((resolve) => {
      runWithProjectEnv({ VERYFRONT_API_TOKEN: "run-token-2" }, () => {
        setTimeout(() => {
          results.push(`task2:${process.env.VERYFRONT_API_TOKEN}`);
          resolve();
        }, 5);
      });
    });

    await Promise.all([task1, task2]);

    assertEquals(results.includes("task1:run-token-1"), true);
    assertEquals(results.includes("task2:run-token-2"), true);
  });
});
