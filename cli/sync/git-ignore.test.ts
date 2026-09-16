import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CommandResult } from "#cli/process-command";
import {
  checkGitIgnoredPaths,
  type GitIgnoreDependencies,
  loadGitIgnoredPaths,
  unquoteGitPath,
} from "./git-ignore.ts";
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

  describe("checkGitIgnoredPaths", () => {
    it("checks paths that need not exist locally in one git check-ignore call", async () => {
      const { dependencies, calls } = fakeGit({
        result: { success: true, code: 0, stdout: "./dist/app.js\n./:odd.gen.ts\n" },
      });

      assertEquals(
        await checkGitIgnoredPaths(
          "/repo/app",
          ["dist/app.js", "pages/index.tsx", ":odd.gen.ts", "dist/app.js"],
          dependencies,
        ),
        ["dist/app.js", ":odd.gen.ts"],
      );
      assertEquals(calls, [{
        args: [
          "-c",
          "core.quotePath=false",
          "check-ignore",
          "./dist/app.js",
          "./pages/index.tsx",
          "./:odd.gen.ts",
        ],
        cwd: "/repo/app",
      }]);
    });

    it("treats exit code 1 as nothing ignored", async () => {
      const { dependencies } = fakeGit({ result: { success: false, code: 1, stdout: "" } });
      assertEquals(await checkGitIgnoredPaths("/repo", ["pages/index.tsx"], dependencies), []);
    });

    it("splits very long path lists across several calls", async () => {
      const { dependencies, calls } = fakeGit({ result: { success: false, code: 1 } });
      const paths = Array.from({ length: 400 }, (_, index) => `${"x".repeat(100)}/${index}.ts`);

      await checkGitIgnoredPaths("/repo", paths, dependencies);

      assertEquals(calls.length > 1, true);
      assertEquals(calls.flatMap((call) => call.args.slice(3)).length, paths.length);
    });

    it("skips Git for no paths or a missing directory", async () => {
      const empty = fakeGit({});
      assertEquals(await checkGitIgnoredPaths("/repo", [], empty.dependencies), []);
      assertEquals(empty.calls.length, 0);

      const missing = fakeGit({ exists: false });
      assertEquals(await checkGitIgnoredPaths("/missing", ["a.ts"], missing.dependencies), []);
      assertEquals(missing.calls.length, 0);
    });

    it("reports nothing outside a Git repository", async () => {
      const { dependencies } = fakeGit({
        result: { success: false, code: 128, stderr: "fatal: not a git repository" },
      });
      assertEquals(await checkGitIgnoredPaths("/plain", ["a.ts"], dependencies), []);
    });

    it("refuses to continue when Git fails inside a repository", async () => {
      const { dependencies } = fakeGit({
        result: { success: false, code: 128, stderr: "fatal: detected dubious ownership" },
        gitMetadata: true,
      });
      await assertRejects(
        () => checkGitIgnoredPaths("/repo", ["a.ts"], dependencies),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });
  });

  describe("unquoteGitPath", () => {
    it("returns unquoted paths unchanged", () => {
      assertEquals(unquoteGitPath("./dist/ünï.ts"), "./dist/ünï.ts");
    });

    it("decodes C-style escapes and octal bytes", () => {
      assertEquals(unquoteGitPath('"./dist/new\\nline.ts"'), "./dist/new\nline.ts");
      assertEquals(unquoteGitPath('"./tab\\t \\"q\\\\.ts"'), './tab\t "q\\.ts');
      assertEquals(unquoteGitPath('"./\\303\\251.ts"'), "./é.ts");
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
