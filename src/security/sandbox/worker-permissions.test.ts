import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";

describe("worker-permissions", () => {
  it("builds permissions with read paths", () => {
    const perms = buildWorkerPermissions(["/tmp/project-a", "/cache"]);
    assertEquals(perms.read, ["/tmp/project-a", "/cache"]);
    assertEquals(perms.write, false);
    assertEquals(perms.net, true);
    assertEquals(perms.env, true);
    assertEquals(perms.run, false);
    assertEquals(perms.ffi, false);
    assertEquals(perms.sys, false);
  });

  it("builds permissions with empty read paths", () => {
    const perms = buildWorkerPermissions([]);
    assertEquals(perms.read, false);
  });

  it("always denies write, run, ffi, sys", () => {
    const perms = buildWorkerPermissions(["/anything"]);
    assertEquals(perms.write, false);
    assertEquals(perms.run, false);
    assertEquals(perms.ffi, false);
    assertEquals(perms.sys, false);
    assertEquals(perms.env, true);
  });

  it("always allows net for data fetchers", () => {
    const perms = buildWorkerPermissions([]);
    assertEquals(perms.net, true);
  });
});
