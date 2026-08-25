import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";

describe("worker-permissions", () => {
  it("builds permissions with read paths", () => {
    const perms = buildWorkerPermissions(["/tmp/project-a", "/cache"]);
    assertEquals(perms.read, ["/tmp/project-a", "/cache"]);
    assertEquals(perms.write, false);
    assertEquals(perms.net, true);
    assertEquals(perms.env, false);
    assertEquals(perms.run, false);
    assertEquals(perms.ffi, false);
    assertEquals(perms.sys, false);
    assertEquals(perms.import, false);
  });

  it("denies process-global env access in compiled workers", () => {
    const perms = buildWorkerPermissions(["/tmp/project-a"], {
      isCompiledBinary: true,
      compiledReadPaths: ["/tmp/deno-compile-abc/dist/framework-src"],
    });

    assertEquals(perms.env, false);
  });

  it("builds permissions with empty read paths", () => {
    const perms = buildWorkerPermissions([]);
    assertEquals(perms.read, false);
  });

  it("keeps compiled-binary read permissions scoped to explicit paths", () => {
    const perms = buildWorkerPermissions(["/tmp/project-a"], {
      isCompiledBinary: true,
      compiledReadPaths: ["/tmp/deno-compile-abc/dist/framework-src"],
    });

    assertEquals(perms.read, ["/tmp/project-a", "/tmp/deno-compile-abc/dist/framework-src"]);
  });

  it("never grants compiled workers shared cache or DENO_DIR roots", () => {
    const cacheKey = "VERYFRONT_CACHE_DIR";
    const denoDirKey = "DENO_DIR";
    const previousCache = Deno.env.get(cacheKey);
    const previousDenoDir = Deno.env.get(denoDirKey);
    const sharedCache = "/tmp/vf-shared-cache-sentinel";
    const sharedDenoDir = "/tmp/vf-shared-deno-dir-sentinel";
    Deno.env.set(cacheKey, sharedCache);
    Deno.env.set(denoDirKey, sharedDenoDir);

    try {
      const perms = buildWorkerPermissions(["/tmp/project-a"], {
        isCompiledBinary: true,
      });
      assert(Array.isArray(perms.read));
      assert(
        !perms.read.some((path) => path === sharedCache || path.startsWith(`${sharedCache}/`)),
      );
      assert(
        !perms.read.some((path) => path === sharedDenoDir || path.startsWith(`${sharedDenoDir}/`)),
      );
    } finally {
      if (previousCache === undefined) Deno.env.delete(cacheKey);
      else Deno.env.set(cacheKey, previousCache);
      if (previousDenoDir === undefined) Deno.env.delete(denoDirKey);
      else Deno.env.set(denoDirKey, previousDenoDir);
    }
  });

  it("limits default compiled support reads to immutable framework directories", () => {
    const frameworkRoot = getFrameworkRootFromMeta(import.meta.url);
    const perms = buildWorkerPermissions(["/tmp/project-a"], {
      isCompiledBinary: true,
    });

    assert(Array.isArray(perms.read));
    assertEquals(perms.read, [
      "/tmp/project-a",
      join(frameworkRoot, "src"),
      join(frameworkRoot, "dist", "framework-src"),
    ]);
    assert(!perms.read.includes(frameworkRoot));
  });

  it("fails closed when a compiled framework read scope is unavailable", () => {
    assertThrows(
      () =>
        buildWorkerPermissions(["/tmp/project-a"], {
          isCompiledBinary: true,
          compiledReadPaths: [],
        }),
      TypeError,
      "framework read scope is unavailable",
    );
  });

  it("always denies write, run, ffi, sys, and remote imports", () => {
    const perms = buildWorkerPermissions(["/anything"]);
    assertEquals(perms.write, false);
    assertEquals(perms.run, false);
    assertEquals(perms.ffi, false);
    assertEquals(perms.sys, false);
    assertEquals(perms.env, false);
    assertEquals(perms.import, false);
  });

  it("defers data fetcher network scoping to ProjectWorker", () => {
    const perms = buildWorkerPermissions([]);
    assertEquals(perms.net, true);
  });

  it("returns consistent results across multiple calls (cached execPath)", () => {
    const perms1 = buildWorkerPermissions(["/path-a"]);
    const perms2 = buildWorkerPermissions(["/path-b"]);

    // Both calls should produce the same structure (only read paths differ)
    assertEquals(perms1.write, perms2.write);
    assertEquals(perms1.net, perms2.net);
    assertEquals(perms1.env, perms2.env);
    assertEquals(perms1.run, perms2.run);
    assertEquals(perms1.ffi, perms2.ffi);
    assertEquals(perms1.sys, perms2.sys);
    assertEquals(perms1.import, perms2.import);
  });
});
