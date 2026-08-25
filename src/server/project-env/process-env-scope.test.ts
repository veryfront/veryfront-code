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
import { inspect } from "node:util";
import {
  createProjectScopedProcessEnvView,
  projectScopedEnvRecord,
} from "#veryfront/platform/compat/process/scoped-process-env.ts";

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
  it("keeps captured views ambient-scope-aware across project requests", () => {
    let snapshot: Readonly<Record<string, string>> | undefined;
    const hostEnv = { HOST_ONLY: "host-value" };
    const view = createProjectScopedProcessEnvView(hostEnv, () => snapshot);
    const saved = view;

    snapshot = { API_KEY: "project-a" };
    assertEquals(saved.API_KEY, "project-a");
    snapshot = { API_KEY: "project-b" };
    assertEquals(saved.API_KEY, "project-b");
    snapshot = undefined;
    assertEquals(saved.API_KEY, undefined);
    assertEquals(saved.HOST_ONLY, "host-value");
    assertEquals(view, saved, "one stable public view must serve every ambient scope");
  });

  it("materializes scoped records without invoking inherited setters", () => {
    const key = "VF_SCOPE_PROBE_INHERITED_SETTER";
    let leaked: unknown;
    Object.defineProperty(Object.prototype, key, {
      set(value) {
        leaked = value;
      },
      configurable: true,
    });
    try {
      const record = projectScopedEnvRecord({ [key]: "project-secret" });
      assertEquals(leaked, undefined);
      assertEquals(record[key], "project-secret");
      assertEquals(Object.hasOwn(record, key), true);
    } finally {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
  });

  it("does not expose host-scoped values through process.env", () => {
    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
        assertEquals(getEnv("VF_SCOPE_PROBE_HOST_ONLY"), undefined);
        assertEquals(processEnv?.["VF_SCOPE_PROBE_HOST_ONLY"], undefined);
      });
    });
  });

  it("does not expose the host environment through inspection", () => {
    withHostVar("VF_SCOPE_PROBE_INSPECT_ONLY", "host-inspection-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
        const formatted = inspect(processEnv);
        assertEquals(formatted.includes("VF_SCOPE_PROBE_INSPECT_ONLY"), false);
        assertEquals(formatted.includes("host-inspection-value"), false);
        assertEquals(formatted.includes("PROJECT_VAR"), true);
        assertEquals(formatted.includes("project-value"), true);
      });
    });
  });

  it("preserves host values during inspection outside a project scope", () => {
    withHostVar("VF_SCOPE_PROBE_INSPECT_HOST", "host-visible-value", () => {
      const formatted = inspect(processEnv);
      assertEquals(formatted.includes("VF_SCOPE_PROBE_INSPECT_HOST"), true);
      assertEquals(formatted.includes("host-visible-value"), true);
    });
  });

  /**
   * The raw environment object as an expression, the way diagnostics access it
   * (`console.dir(process.env)`), so each access resolves the scope-appropriate
   * view rather than reusing the module-level capture.
   */
  function freshEnv(): Record<string, string | undefined> {
    return (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process!.env;
  }

  it("keeps generic inspection opaque when custom inspect hooks are disabled", () => {
    // console.dir and inspect(v, { customInspect: false }) skip the custom
    // inspect hook. Node and Bun read the proxy target directly, so neither host
    // nor tenant environment values may be stored there.
    withHostVar("VF_SCOPE_PROBE_RAW_INSPECT", "host-raw-value", () => {
      runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
        const formatted = inspect(freshEnv(), { customInspect: false });
        assertEquals(formatted.includes("VF_SCOPE_PROBE_RAW_INSPECT"), false);
        assertEquals(formatted.includes("host-raw-value"), false);
      });
    });
  });

  it("reflects scoped writes and deletes through the scoped inspect hook", () => {
    runWithProjectEnv(
      { PROJECT_VAR: "project-value", VF_SCOPE_PROBE_DROPPED: "dropped-value" },
      () => {
        // Mutate through the module-captured view so the write travels between
        // views: the snapshot's materialized record must pick it up anyway.
        processEnv!["VF_SCOPE_PROBE_RAW_WRITTEN"] = "written-in-scope";
        delete processEnv!["VF_SCOPE_PROBE_DROPPED"];

        const formatted = inspect(freshEnv());
        assertEquals(formatted.includes("VF_SCOPE_PROBE_RAW_WRITTEN"), true);
        assertEquals(formatted.includes("written-in-scope"), true);
        assertEquals(formatted.includes("VF_SCOPE_PROBE_DROPPED"), false);
        assertEquals(formatted.includes("PROJECT_VAR"), true);
      },
    );
  });

  it("keeps scoped inspection distinct across nested scopes", () => {
    runWithProjectEnv({ VF_SCOPE_PROBE_NESTED: "outer-value" }, () => {
      runWithProjectEnv({ VF_SCOPE_PROBE_NESTED: "inner-value" }, () => {
        const formatted = inspect(freshEnv());
        assertEquals(formatted.includes("inner-value"), true);
        assertEquals(formatted.includes("outer-value"), false);
      });
      const formatted = inspect(freshEnv());
      assertEquals(formatted.includes("outer-value"), true);
      assertEquals(formatted.includes("inner-value"), false);
    });
  });

  it("does not leak a finished scope's values through generic inspection", () => {
    runWithProjectEnv({ VF_SCOPE_PROBE_FINISHED: "finished-scope-value" }, () => {
      assertEquals(
        inspect(freshEnv()).includes("finished-scope-value"),
        true,
      );
    });
    const formatted = inspect(freshEnv(), { customInspect: false });
    assertEquals(formatted.includes("VF_SCOPE_PROBE_FINISHED"), false);
    assertEquals(formatted.includes("finished-scope-value"), false);
  });

  it("keeps process.env identity stable within a scope and at host level", () => {
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      assertEquals(freshEnv() === freshEnv(), true);
    });
    assertEquals(freshEnv() === freshEnv(), true);
    assertEquals(freshEnv() === processEnv, true);
  });

  it("preserves the native environment prototype", () => {
    assertEquals(Object.getPrototypeOf(processEnv), Object.prototype);
    assertEquals(processEnv instanceof Object, true);
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      assertEquals(Object.getPrototypeOf(freshEnv()), Object.prototype);
      assertEquals(freshEnv() instanceof Object, true);
    });
  });

  it("rejects attempts to make the shared view non-extensible", () => {
    assertThrows(() => Object.preventExtensions(processEnv!), TypeError);
    assertEquals(Object.isExtensible(processEnv!), true);
    assertEquals(Object.keys(processEnv!).length > 0, true);
    runWithProjectEnv({ PROJECT_VAR: "project-value" }, () => {
      assertThrows(() => Object.preventExtensions(freshEnv()), TypeError);
      assertEquals(Object.isExtensible(freshEnv()), true);
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

  it("merges without clearing when process.env is assigned outside any scope", () => {
    const processLike = (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process!;
    const view = processLike.env;

    withHostVar("VF_SCOPE_PROBE_HOST_ONLY", "host-scoped-value", () => {
      try {
        processLike.env = { VF_SCOPE_PROBE_ASSIGNED: "assigned" };

        assertEquals(processLike.env, view, "assignment must not detach the installed view");
        assertEquals(
          processEnv?.["VF_SCOPE_PROBE_HOST_ONLY"],
          "host-scoped-value",
          "a host-level assignment adds and overwrites but never clears",
        );
        assertEquals(
          (processEnv?.["PATH"]?.length ?? 0) > 0,
          true,
          "PATH must survive a host-level assignment",
        );
        assertEquals(
          processEnv?.["VF_SCOPE_PROBE_ASSIGNED"],
          "assigned",
          "assigned keys are added",
        );
      } finally {
        delete processEnv!["VF_SCOPE_PROBE_ASSIGNED"];
      }
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
