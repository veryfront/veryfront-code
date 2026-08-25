import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for lock command
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { lockCommand } from "./index.ts";

describe("lock command", () => {
  describe("lockCommand", () => {
    it("is a function", () => {
      assertEquals(typeof lockCommand, "function");
    });

    it("accepts options with projectDir", () => {
      assertEquals(lockCommand.length, 1);
    });

    it("clears malformed lockfiles when recovery is explicitly forced", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "veryfront-lock-clear-malformed-" });
      const lockfilePath = `${projectDir}/veryfront.lock`;
      try {
        await Deno.writeTextFile(lockfilePath, "{not-json");

        await lockCommand({ projectDir, clear: true, force: true });

        assertEquals(await exists(lockfilePath), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("clears newer-format lockfiles when recovery is explicitly forced", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "veryfront-lock-clear-newer-" });
      const lockfilePath = `${projectDir}/veryfront.lock`;
      try {
        await Deno.writeTextFile(
          lockfilePath,
          JSON.stringify({
            version: 99,
            imports: { newer: { resolved: "newer", integrity: "sha256-newer" } },
          }),
        );

        await lockCommand({ projectDir, clear: true, force: true });

        assertEquals(await exists(lockfilePath), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});
