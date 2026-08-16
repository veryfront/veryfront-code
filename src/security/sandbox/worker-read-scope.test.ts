import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { VeryfrontError } from "#veryfront/errors";
import { assertWorkerReadScopeConfined } from "./worker-read-scope.ts";

describe("worker read scope", () => {
  it("allows a symlink whose target is inside another allowed root", async () => {
    const firstRoot = await Deno.makeTempDir();
    const secondRoot = await Deno.makeTempDir();
    const target = join(secondRoot, "shared.txt");
    await Deno.writeTextFile(target, "shared");
    await Deno.symlink(target, join(firstRoot, "shared.txt"));

    try {
      assertWorkerReadScopeConfined([firstRoot, secondRoot]);
    } finally {
      await Deno.remove(firstRoot, { recursive: true });
      await Deno.remove(secondRoot, { recursive: true });
    }
  });

  it("rejects dangling symlinks", async () => {
    const root = await Deno.makeTempDir();
    await Deno.symlink(join(root, "missing.txt"), join(root, "dangling.txt"));

    try {
      assertThrows(
        () => assertWorkerReadScopeConfined([root]),
        VeryfrontError,
        "Worker read scope contains a symlink outside its allowed roots",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("ignores an optional read root that does not exist at startup", () => {
    const missingRoot = join(
      Deno.cwd(),
      `.veryfront-missing-worker-root-${crypto.randomUUID()}`,
    );
    assertWorkerReadScopeConfined([missingRoot]);
  });
});
