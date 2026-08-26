/**
 * Missing scaffold parents are created by an isolated process rooted in the
 * validated project directory. This regression mutates the host process's
 * filesystem primitive, so it belongs at the semantic integration boundary.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";

import { scaffoldAuthFiles } from "../../../../../cli/scaffold/engine.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

describe("scaffold missing-parent containment", () => {
  it("creates missing parents through the pinned writer context", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-scaffold-project-" });
    const parent = join(projectDir, "nested");
    const movedParent = join(projectDir, "nested-original");
    const outside = await makeTempDir({ prefix: "vf-scaffold-mkdir-race-" });
    await Deno.mkdir(parent);
    const originalMkdir = Deno.mkdir;
    let interceptedPathCreation = false;
    Deno.mkdir = async (path, options) => {
      if (String(path) === join(parent, "missing")) {
        interceptedPathCreation = true;
        await Deno.rename(parent, movedParent);
        await Deno.symlink(outside, parent);
      }
      return await originalMkdir(path, options);
    };
    try {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{
          path: join(parent, "missing", "target.txt"),
          content: "inside",
        }],
      });

      assertEquals(result.success, true);
      assertEquals(interceptedPathCreation, false);
      assertEquals(await Deno.readTextFile(join(parent, "missing", "target.txt")), "inside");
      assertEquals(await exists(join(outside, "missing")), false);
    } finally {
      Deno.mkdir = originalMkdir;
      await Deno.remove(outside, { recursive: true });
      if (await exists(movedParent)) {
        await Deno.remove(parent).catch(() => undefined);
        await Deno.rename(movedParent, parent);
      }
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
