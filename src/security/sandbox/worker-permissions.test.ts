import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildWorkerPermissions, FRAMEWORK_WORKER_ENV_ALLOWLIST } from "./worker-permissions.ts";

describe("worker-permissions", () => {
  it("builds permissions with read paths", () => {
    const perms = buildWorkerPermissions(["/tmp/project-a", "/cache"]);
    assertEquals(perms.read, ["/tmp/project-a", "/cache"]);
    assertEquals(perms.write, false);
    assertEquals(perms.net, true);
    assertEquals(perms.env, [...FRAMEWORK_WORKER_ENV_ALLOWLIST]);
    assertEquals(perms.run, false);
    assertEquals(perms.ffi, false);
    assertEquals(perms.sys, false);
  });

  it("allows only framework and project env keys", () => {
    const perms = buildWorkerPermissions(["/tmp/project-a"], {
      projectEnvKeys: [
        "VERYFRONT_TEST_PROJECT_SECRET",
        "NODE_ENV",
        "",
        "  VERYFRONT_TEST_PROJECT_SECRET  ",
      ],
    });

    assertEquals(perms.env, [
      ...FRAMEWORK_WORKER_ENV_ALLOWLIST,
      "VERYFRONT_TEST_PROJECT_SECRET",
    ]);
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

  it("always denies write, run, ffi, sys", () => {
    const perms = buildWorkerPermissions(["/anything"]);
    assertEquals(perms.write, false);
    assertEquals(perms.run, false);
    assertEquals(perms.ffi, false);
    assertEquals(perms.sys, false);
    assertEquals(perms.env, [...FRAMEWORK_WORKER_ENV_ALLOWLIST]);
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
  });
});
