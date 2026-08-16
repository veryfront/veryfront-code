import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertWorkerReadScopeConfined,
  createWorkerReadScopeGenerationAudit,
} from "./worker-read-scope.ts";

describe("worker read scope", () => {
  it("audits each immutable source generation once", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsidePath = join(outsideDir, "secret.txt");
    const linkedPath = join(projectDir, "linked-secret.txt");
    await Deno.writeTextFile(outsidePath, "outside secret");

    try {
      const currentGeneration = createWorkerReadScopeGenerationAudit([projectDir]);
      currentGeneration();
      await Deno.symlink(outsidePath, linkedPath);

      currentGeneration();

      const replacementGeneration = createWorkerReadScopeGenerationAudit([projectDir]);
      assertThrows(
        replacementGeneration,
        VeryfrontError,
        "Worker read scope contains a symlink outside its allowed roots",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

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

  it("rejects a read root that is itself a symlink", async () => {
    const sandbox = await Deno.makeTempDir();
    const targetRoot = join(sandbox, "target", "project");
    const linkedRoot = join(sandbox, "linked-project");
    await Deno.mkdir(targetRoot, { recursive: true });
    await Deno.writeTextFile(join(sandbox, "target", "secret.txt"), "outside secret");
    await Deno.symlink(targetRoot, linkedRoot, { type: "dir" });

    try {
      assertThrows(
        () => assertWorkerReadScopeConfined([linkedRoot]),
        VeryfrontError,
        "Worker read scope contains a symlink outside its allowed roots",
      );
    } finally {
      await Deno.remove(sandbox, { recursive: true });
    }
  });

  it("rejects a directory symlink that can escape through parent traversal", async () => {
    const sandbox = await Deno.makeTempDir();
    const root = join(sandbox, "project");
    const nested = join(root, "nested");
    await Deno.mkdir(nested, { recursive: true });
    await Deno.writeTextFile(join(sandbox, "secret.txt"), "outside secret");
    await Deno.symlink(root, join(nested, "project-root"), { type: "dir" });

    try {
      assertThrows(
        () => assertWorkerReadScopeConfined([root]),
        VeryfrontError,
        "Worker read scope contains a symlink outside its allowed roots",
      );
    } finally {
      await Deno.remove(sandbox, { recursive: true });
    }
  });

  it("allows a directory symlink whose parent traversal stays in scope", async () => {
    const root = await Deno.makeTempDir();
    const target = join(root, "packages", "shared");
    await Deno.mkdir(target, { recursive: true });
    await Deno.symlink(target, join(root, "shared"), { type: "dir" });

    try {
      assertWorkerReadScopeConfined([root]);
    } finally {
      await Deno.remove(root, { recursive: true });
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
