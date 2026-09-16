import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CommandResult } from "#cli/process-command";
import { type GitIgnoreDependencies, loadGitIgnoredPaths } from "./git-ignore.ts";
import { createDefaultIgnoreChecker, createIgnoreChecker } from "./ignore.ts";

interface FakeGitOptions {
  exists?: boolean;
  gitMetadata?: boolean;
  result?: CommandResult;
  spawnError?: Error;
}

function fakeGit(options: FakeGitOptions): {
  dependencies: GitIgnoreDependencies;
  calls: { args: readonly string[]; cwd?: string }[];
} {
  const calls: { args: readonly string[]; cwd?: string }[] = [];
  const dependencies: GitIgnoreDependencies = {
    runCommand: (_cmd, commandOptions = {}) => {
      calls.push({ args: commandOptions.args ?? [], cwd: commandOptions.cwd });
      if (options.spawnError) return Promise.reject(options.spawnError);
      return Promise.resolve(options.result ?? { success: true, code: 0, stdout: "" });
    },
    hasGitMetadata: () => Promise.resolve(options.gitMetadata ?? false),
    projectDirExists: () => Promise.resolve(options.exists ?? true),
  };
  return { dependencies, calls };
}

describe("cli/sync/git-ignore", () => {
  describe("loadGitIgnoredPaths", () => {
    it("asks Git for every ignore source from the project directory", async () => {
      const { dependencies, calls } = fakeGit({
        result: { success: true, code: 0, stdout: ".context/\0dist/y.js\0scratch.md\0" },
      });

      assertEquals(await loadGitIgnoredPaths("/repo/app", dependencies), [
        ".context",
        "dist/y.js",
        "scratch.md",
      ]);
      assertEquals(calls, [{
        args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
        cwd: "/repo/app",
      }]);
    });

    it("returns no paths for a project directory that does not exist yet", async () => {
      const { dependencies, calls } = fakeGit({ exists: false });
      assertEquals(await loadGitIgnoredPaths("/missing", dependencies), []);
      assertEquals(calls.length, 0);
    });

    it("returns no paths outside a Git repository", async () => {
      const { dependencies } = fakeGit({
        result: {
          success: false,
          code: 128,
          stderr: "fatal: not a git repository (or any of the parent directories): .git",
        },
      });
      assertEquals(await loadGitIgnoredPaths("/plain", dependencies), []);
    });

    it("returns no paths when Git is missing and no repository surrounds the project", async () => {
      const { dependencies } = fakeGit({ spawnError: new Error("git: not found") });
      assertEquals(await loadGitIgnoredPaths("/plain", dependencies), []);
    });

    it("refuses to continue when Git is missing inside a repository", async () => {
      const { dependencies } = fakeGit({
        spawnError: new Error("git: not found"),
        gitMetadata: true,
      });
      await assertRejects(
        () => loadGitIgnoredPaths("/repo", dependencies),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });

    it("refuses to continue when Git fails inside a repository", async () => {
      const { dependencies } = fakeGit({
        result: { success: false, code: 128, stderr: "fatal: detected dubious ownership" },
        gitMetadata: true,
      });
      await assertRejects(
        () => loadGitIgnoredPaths("/repo", dependencies),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });

    it("refuses a truncated Git listing", async () => {
      const { dependencies } = fakeGit({
        result: { success: true, code: 0, stdout: ".context/\0", outputTruncated: true },
      });
      await assertRejects(
        () => loadGitIgnoredPaths("/repo", dependencies),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });
  });

  describe("createIgnoreChecker with Git-ignored paths", () => {
    it("ignores a Git-ignored directory and its descendants", () => {
      const checker = createIgnoreChecker([], { gitIgnoredPaths: [".context/", "a/b.ts"] });

      assertEquals(checker.isIgnored(".context", { isDirectory: true }), true);
      assertEquals(checker.isIgnored(".context/todos.md"), true);
      assertEquals(checker.isIgnored(".context/attachments/note.md"), true);
      assertEquals(checker.isIgnored("a/b.ts"), true);
      assertEquals(checker.isIgnored("a/c.ts"), false);
      assertEquals(checker.isIgnored(".contextual/todos.md"), false);
    });

    it("lets a .vfignore negation re-include a Git-ignored path", () => {
      const checker = createIgnoreChecker(["dist", "!dist"], {
        gitIgnoredPaths: ["dist", "generated/data.json"],
      });

      assertEquals(checker.isIgnored("dist", { isDirectory: true }), false);
      assertEquals(checker.isIgnored("dist/app.js"), false);
      assertEquals(checker.isIgnored("generated/data.json"), true);

      const reincluded = createIgnoreChecker(["!generated/data.json"], {
        gitIgnoredPaths: ["generated/data.json"],
      });
      assertEquals(reincluded.isIgnored("generated/data.json"), false);
    });

    it("keeps protected paths ignored regardless of Git", () => {
      const checker = createIgnoreChecker(["!.env.local"], { gitIgnoredPaths: [] });
      assertEquals(checker.isIgnored(".env.local"), true);
    });
  });

  it("ignores .context by default outside Git", () => {
    const checker = createDefaultIgnoreChecker();
    assertEquals(checker.isIgnored(".context", { isDirectory: true }), true);
    assertEquals(checker.isIgnored(".context/todos.md"), true);
  });
});
