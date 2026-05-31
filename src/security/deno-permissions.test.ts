import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BUILD_HELPER_PERMISSIONS,
  SERVER_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
} from "./deno-permissions.ts";

describe("deno-permissions", () => {
  describe("SERVER_PERMISSIONS", () => {
    it("includes explicit permissions without allow-all", () => {
      const flags = SERVER_PERMISSIONS.join(" ");
      assertEquals(flags.includes("allow-read"), true);
      assertEquals(flags.includes("allow-write"), true);
      assertEquals(flags.includes("allow-net"), true);
      assertEquals(flags.includes("allow-env"), true);
      assertEquals(flags.includes("allow-run"), true);
      assertEquals(flags.includes("allow-sys"), true);
      assertEquals(flags.includes("unstable-worker-options"), true);
      assertEquals(flags.includes("unstable-net"), true);
      assertEquals(flags.includes("allow-all"), false);
      // ffi and hrtime intentionally excluded from server permissions
      assertEquals(flags.includes("allow-ffi"), false);
      assertEquals(flags.includes("allow-hrtime"), false);
    });
  });

  describe("WORKFLOW_RUN_PERMISSIONS (restricted)", () => {
    it("only grants read, write, net, env", () => {
      assertEquals(WORKFLOW_RUN_PERMISSIONS.includes("--allow-read"), true);
      assertEquals(WORKFLOW_RUN_PERMISSIONS.includes("--allow-write"), true);
      assertEquals(WORKFLOW_RUN_PERMISSIONS.includes("--allow-net"), true);
      assertEquals(WORKFLOW_RUN_PERMISSIONS.includes("--allow-env"), true);
    });

    it("does NOT grant run, ffi, or sys", () => {
      const flags = WORKFLOW_RUN_PERMISSIONS.join(" ");
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
