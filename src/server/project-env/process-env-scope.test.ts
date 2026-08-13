import "#veryfront/schemas/_test-setup.ts";
/**
 * Regression tests for the project environment view on the raw process env object.
 *
 * A project environment snapshot is the complete environment a project sees.
 * `getEnv()` already serves the snapshot and nothing else while the snapshot is
 * active; the raw `process.env` object must present the same view, so the two
 * accessors cannot disagree about what the project environment contains.
 *
 * Framework-owned configuration is read through `getHostEnv()`, which stays
 * outside the project scope by design and must keep working while a snapshot
 * is active.
 *
 * @module server/project-env/process-env-scope.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { env, getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";

// Importing storage registers the project env scope bridge.
import { runWithProjectEnv } from "./storage.ts";

const processEnv = (globalThis as {
  process?: { env: Record<string, string | undefined> };
}).process?.env;

/**
 * Set a host variable outside any project scope.
 *
 * Written through `process.env` rather than a runtime-specific env API: outside
 * a scope the view passes straight through to the host record, and staying
 * runtime-neutral keeps this suite eligible on every runner rather than the
 * Deno one alone. `process.env` is the surface under test, so it should be
 * exercised on the runtimes that own it.
 */
function withHostVar(key: string, value: string, fn: () => void): void {
  const original = processEnv?.[key];
  processEnv![key] = value;
  try {
    fn();
  } finally {
    if (original === undefined) delete processEnv![key];
    else processEnv![key] = original;
  }
}

describe("process.env under an active project env snapshot", () => {
  it("does not expose host-scoped values through process.env", () => {
    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
        assertEquals(getEnv("VF_SCOPE_PROBE_HOST_ONLY"), undefined);
        assertEquals(processEnv?.["VF_SCOPE_PROBE_HOST_ONLY"], undefined);
      });
    });
  });

  it("serves project snapshot values through process.env", () => {
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      assertEquals(processEnv?.["PROJECT_VAR"], "project-value");
    });
  });

  it("reports only snapshot keys when enumerating process.env", () => {
    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
        const keys = Object.keys(processEnv ?? {});
        assertEquals(keys.includes("PROJECT_VAR"), true);
        assertEquals(keys.includes("VF_SCOPE_PROBE_HOST_ONLY"), false);
        assertEquals("VF_SCOPE_PROBE_HOST_ONLY" in (processEnv ?? {}), false);
      });
    });
  });

  it("keeps framework-owned host reads working inside the snapshot scope", () => {
    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
        assertEquals(getHostEnv("VF_SCOPE_PROBE_HOST_ONLY"), "host-scoped-value");
        assertEquals((getHostEnv("PATH")?.length ?? 0) > 0, true);
      });
    });
  });

  it("leaves process.env untouched outside any snapshot scope", () => {
    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      assertEquals(processEnv?.["VF_SCOPE_PROBE_HOST_ONLY"], "host-scoped-value");
      assertEquals((processEnv?.["PATH"]?.length ?? 0) > 0, true);
    });
  });

  it("keeps writes made inside a scope inside that scope", () => {
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      processEnv!["VF_SCOPE_PROBE_WRITTEN"] = "written-in-scope";
      assertEquals(processEnv?.["VF_SCOPE_PROBE_WRITTEN"], "written-in-scope");

      delete processEnv!["PROJECT_VAR"];
      assertEquals(processEnv?.["PROJECT_VAR"], undefined);
    });

    assertEquals(processEnv?.["VF_SCOPE_PROBE_WRITTEN"], undefined);
    assertEquals(getHostEnv("VF_SCOPE_PROBE_WRITTEN"), undefined);

    // A later scope over the same variables starts from its own snapshot.
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      assertEquals(processEnv?.["PROJECT_VAR"], "project-value");
      assertEquals(processEnv?.["VF_SCOPE_PROBE_WRITTEN"], undefined);
    });
  });

  it("gives the bulk env() accessor the same view as getEnv()", () => {
    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
        const scoped = env();
        assertEquals(scoped["PROJECT_VAR"], "project-value");
        assertEquals("VF_SCOPE_PROBE_HOST_ONLY" in scoped, false);
      });

      assertEquals(env()["VF_SCOPE_PROBE_HOST_ONLY"], "host-scoped-value");
    });
  });

  it("serves scoped writes through getEnv() and env() as well", () => {
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      processEnv!["VF_SCOPE_PROBE_WRITTEN"] = "written-in-scope";
      assertEquals(getEnv("VF_SCOPE_PROBE_WRITTEN"), "written-in-scope");
      assertEquals(env()["VF_SCOPE_PROBE_WRITTEN"], "written-in-scope");

      delete processEnv!["PROJECT_VAR"];
      assertEquals(getEnv("PROJECT_VAR"), undefined);
      assertEquals("PROJECT_VAR" in env(), false);
    });
  });

  it("rejects descriptors the raw environment object never accepts", () => {
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      assertThrows(
        () => Object.defineProperty(processEnv!, "VF_SCOPE_PROBE_DESC", { value: "v" }),
        TypeError,
      );
      assertThrows(
        () =>
          Object.defineProperty(processEnv!, "VF_SCOPE_PROBE_DESC", {
            get: () => "v",
            enumerable: true,
            configurable: true,
          }),
        TypeError,
      );
      assertEquals(processEnv?.["VF_SCOPE_PROBE_DESC"], undefined);

      Object.defineProperty(processEnv!, "VF_SCOPE_PROBE_DESC", {
        value: "v",
        writable: true,
        enumerable: true,
        configurable: true,
      });
      assertEquals(processEnv?.["VF_SCOPE_PROBE_DESC"], "v");
      assertEquals(getEnv("VF_SCOPE_PROBE_DESC"), "v");
    });
  });

  it("keeps the scoped view installed when process.env is assigned", () => {
    const processLike = (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process!;
    const view = processLike.env;

    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      processLike.env = { VF_SCOPE_PROBE_ASSIGNED: "assigned" };

      assertEquals(processLike.env, view);
      assertEquals(processLike.env["VF_SCOPE_PROBE_ASSIGNED"], "assigned");
      // Applied inside the scope, so the replaced snapshot key is gone with it.
      assertEquals(processLike.env["PROJECT_VAR"], undefined);

      // Assigning the object to itself is identity, not a wipe.
      const same = processLike.env;
      processLike.env = same;
      assertEquals(processLike.env["VF_SCOPE_PROBE_ASSIGNED"], "assigned");
    });

    assertEquals(processLike.env, view);
    assertEquals(processLike.env["VF_SCOPE_PROBE_ASSIGNED"], undefined);

    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      assertEquals(processLike.env["PROJECT_VAR"], "project-value");
    });
  });

  it("restores the host view when a nested scope exits", () => {
    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "outer" }, () => {
        runWithProjectEnv({ PROJECT_VAR: "inner" }, () => {
          assertEquals(processEnv?.["PROJECT_VAR"], "inner");
        });
        assertEquals(processEnv?.["PROJECT_VAR"], "outer");
      });

      assertEquals(processEnv?.["PROJECT_VAR"], undefined);
      assertEquals(processEnv?.["VF_SCOPE_PROBE_HOST_ONLY"], "host-scoped-value");
    });
  });
});
