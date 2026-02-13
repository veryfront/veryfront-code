import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BUILD_HELPER_PERMISSIONS,
  BUILD_PERMISSIONS,
  SCRIPT_PERMISSIONS,
  SERVER_PERMISSIONS,
  TEST_PERMISSIONS,
  toFlagString,
  WORKFLOW_JOB_PERMISSIONS,
} from "./deno-permissions.ts";

describe("deno-permissions", () => {
  describe("toFlagString", () => {
    it("joins flags with spaces", () => {
      assertEquals(toFlagString(["--allow-read", "--allow-write"]), "--allow-read --allow-write");
    });

    it("returns empty string for empty array", () => {
      assertEquals(toFlagString([]), "");
    });
  });

  describe("SERVER_PERMISSIONS", () => {
    it("includes all standard permissions except allow-hrtime", () => {
      assertEquals(SERVER_PERMISSIONS.includes("--allow-read"), true);
      assertEquals(SERVER_PERMISSIONS.includes("--allow-write"), true);
      assertEquals(SERVER_PERMISSIONS.includes("--allow-net"), true);
      assertEquals(SERVER_PERMISSIONS.includes("--allow-env"), true);
      assertEquals(SERVER_PERMISSIONS.includes("--allow-run"), true);
      assertEquals(SERVER_PERMISSIONS.includes("--allow-ffi"), true);
      assertEquals(SERVER_PERMISSIONS.includes("--allow-sys"), true);
    });

    it("does not include --allow-all or --allow-hrtime", () => {
      const str = toFlagString(SERVER_PERMISSIONS);
      assertEquals(str.includes("allow-all"), false);
      assertEquals(str.includes("allow-hrtime"), false);
    });
  });

  describe("WORKFLOW_JOB_PERMISSIONS (restricted)", () => {
    it("only grants read, write, net, env", () => {
      assertEquals(WORKFLOW_JOB_PERMISSIONS.includes("--allow-read"), true);
      assertEquals(WORKFLOW_JOB_PERMISSIONS.includes("--allow-write"), true);
      assertEquals(WORKFLOW_JOB_PERMISSIONS.includes("--allow-net"), true);
      assertEquals(WORKFLOW_JOB_PERMISSIONS.includes("--allow-env"), true);
    });

    it("does NOT grant run, ffi, or sys", () => {
      const str = toFlagString(WORKFLOW_JOB_PERMISSIONS);
      assertEquals(str.includes("allow-run"), false);
      assertEquals(str.includes("allow-ffi"), false);
      assertEquals(str.includes("allow-sys"), false);
    });
  });

  describe("BUILD_HELPER_PERMISSIONS", () => {
    it("only grants read, write, env", () => {
      assertEquals(BUILD_HELPER_PERMISSIONS.length, 3);
      assertEquals(BUILD_HELPER_PERMISSIONS.includes("--allow-read"), true);
      assertEquals(BUILD_HELPER_PERMISSIONS.includes("--allow-write"), true);
      assertEquals(BUILD_HELPER_PERMISSIONS.includes("--allow-env"), true);
    });
  });

  describe("SCRIPT_PERMISSIONS", () => {
    it("grants read, write, net, env, run, sys but not ffi", () => {
      assertEquals(SCRIPT_PERMISSIONS.includes("--allow-read"), true);
      assertEquals(SCRIPT_PERMISSIONS.includes("--allow-run"), true);
      assertEquals(SCRIPT_PERMISSIONS.includes("--allow-sys"), true);
      const str = toFlagString(SCRIPT_PERMISSIONS);
      assertEquals(str.includes("allow-ffi"), false);
    });
  });

  describe("profile aliases", () => {
    it("BUILD_PERMISSIONS matches SERVER_PERMISSIONS", () => {
      assertEquals([...BUILD_PERMISSIONS], [...SERVER_PERMISSIONS]);
    });

    it("TEST_PERMISSIONS matches SERVER_PERMISSIONS", () => {
      assertEquals([...TEST_PERMISSIONS], [...SERVER_PERMISSIONS]);
    });
  });
});
