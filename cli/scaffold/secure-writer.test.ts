import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";

import { testEnterPinnedParent } from "./secure-writer.ts";

describe("secure scaffold writer", () => {
  it("rejects a checked parent moved outside the project before chdir", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-scaffold-enter-project-" });
    const outside = await Deno.makeTempDir({ prefix: "vf-scaffold-enter-outside-" });
    const parent = join(projectDir, "nested");
    const movedParent = join(outside, "nested");
    const originalCwd = Deno.cwd();
    let symlinkSupported = true;
    let rejection: unknown;
    await Deno.mkdir(parent);
    Deno.chdir(projectDir);

    try {
      try {
        await testEnterPinnedParent({
          parts: ["nested"],
          beforeEnter: async () => {
            await Deno.rename(parent, movedParent);
            try {
              await Deno.symlink(movedParent, parent);
            } catch (error) {
              if (!(error instanceof Deno.errors.PermissionDenied)) throw error;
              symlinkSupported = false;
              await Deno.rename(movedParent, parent);
            }
          },
        });
      } catch (error) {
        rejection = error;
      }

      if (!symlinkSupported) return;
      assertEquals(rejection instanceof TypeError, true);
      if (!(rejection instanceof TypeError)) throw new Error("Expected containment rejection");
      assertEquals(rejection.message, "unsafe-directory");
    } finally {
      Deno.chdir(originalCwd);
      await Deno.remove(parent).catch(() => undefined);
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  });
});
