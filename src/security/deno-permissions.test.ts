import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BUILD_HELPER_PERMISSIONS,
  SERVER_PERMISSIONS,
  WORKFLOW_JOB_PERMISSIONS,
} from "./deno-permissions.ts";

describe("deno-permissions", () => {
  describe("SERVER_PERMISSIONS", () => {
    it("includes all standard permissions except allow-hrtime", () => {
      const flags = SERVER_PERMISSIONS.join(" ");
      assertEquals(flags.includes("allow-read"), true);
      assertEquals(flags.includes("allow-write"), true);
      assertEquals(flags.includes("allow-net"), true);
      assertEquals(flags.includes("allow-env"), true);
      assertEquals(flags.includes("allow-run"), true);
      assertEquals(flags.includes("allow-ffi"), true);
      assertEquals(flags.includes("allow-sys"), true);
      assertEquals(flags.includes("allow-all"), false);
      assertEquals(flags.includes("allow-hrtime"), false);
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
      const flags = WORKFLOW_JOB_PERMISSIONS.join(" ");
      assertEquals(flags.includes("allow-run"), false);
      assertEquals(flags.includes("allow-ffi"), false);
      assertEquals(flags.includes("allow-sys"), false);
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
});
