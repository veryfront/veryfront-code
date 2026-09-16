import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CommandResult } from "#cli/process-command";
import {
  type GitIgnoreDependencies,
  loadGitIgnoreContext,
  trimTrailingSlashes,
  unquoteGitPath,
} from "./git-ignore.ts";
import { createDefaultIgnoreChecker, createIgnoreChecker } from "./ignore.ts";

const NOTHING_IGNORED: CommandResult = { success: false, code: 1, stdout: "" };

interface FakeGitOptions {
  /** Directories that exist; defaults to every path. */
  existing?: readonly string[];
  /** Paths that are symbolic links. */
  symlinks?: readonly string[];
  gitMetadata?: boolean;
  /** Answer each Git invocation; defaults to "nothing ignored". */
  respond?: (args: readonly string[]) => CommandResult | Error;
}

interface FakeGitCall {
  args: readonly string[];
  cwd?: string;
}

const commandSettings: { env?: Record<string, string>; maxOutputBytes?: number }[] = [];

function fakeGit(options: FakeGitOptions = {}): {
  dependencies: GitIgnoreDependencies;
  calls: FakeGitCall[];
  warnings: string[];
} {
  const calls: FakeGitCall[] = [];
  const warnings: string[] = [];
  const dependencies: GitIgnoreDependencies = {
    runCommand: (_cmd, commandOptions = {}) => {
      const args = commandOptions.args ?? [];
      calls.push({ args, cwd: commandOptions.cwd });
      commandSettings.push({
        env: commandOptions.env,
        maxOutputBytes: commandOptions.maxOutputBytes,
      });
      const answer = options.respond?.(args) ?? NOTHING_IGNORED;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    hasGitMetadata: () => Promise.resolve(options.gitMetadata ?? false),
    pathExists: (path) =>
      Promise.resolve(options.existing === undefined || options.existing.includes(path)),
    isSymlink: (path) => Promise.resolve(options.symlinks?.includes(path) ?? false),
    warnIgnoredProjectDirectory: (projectDir) => warnings.push(projectDir),
  };
  return { dependencies, calls, warnings };
}

const isRootCheck = (args: readonly string[]) => args[0] === "check-ignore";
const isListing = (args: readonly string[]) => args[0] === "ls-files" && args.includes("--ignored");
const isUntrackedListing = (args: readonly string[]) =>
  args[0] === "ls-files" && args[1] === "--others" && !args.includes("--ignored");
const isIndexListing = (args: readonly string[]) => args[0] === "ls-files" && args[1] === "--stage";

describe("cli/sync/git-ignore", () => {
  describe("loadGitIgnoreContext", () => {
    it("lists ignored local paths once the project directory itself is not ignored", async () => {
      const { dependencies, calls, warnings } = fakeGit({
        respond: (args) =>
          isListing(args)
            ? { success: true, code: 0, stdout: ".context/\0dist/y.js\0scratch.md\0" }
            : NOTHING_IGNORED,
      });

      const context = await loadGitIgnoreContext("/repo/app", dependencies);

      assertEquals(context.ignoredPaths, [".context", "dist/y.js", "scratch.md"]);
      assertEquals(calls, [
        { args: ["check-ignore", "--quiet", "./"], cwd: "/repo/app" },
        {
          args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
          cwd: "/repo/app",
        },
        { args: ["ls-files", "--stage", "-z"], cwd: "/repo/app" },
      ]);
      assertEquals(warnings, []);
    });

    it("runs Git in the C locale and gives path listings a larger output cap", async () => {
      commandSettings.length = 0;
      const { dependencies, calls } = fakeGit({
        respond: (args) =>
          isListing(args) || isIndexListing(args) || isUntrackedListing(args)
            ? { success: true, code: 0, stdout: "" }
            : NOTHING_IGNORED,
      });

      await loadGitIgnoreContext("/repo", dependencies);

      assertEquals(calls.length, commandSettings.length);
      for (const [index, call] of calls.entries()) {
        assertEquals(commandSettings[index]?.env?.LC_ALL, "C");
        assertEquals(
          commandSettings[index]?.maxOutputBytes,
          call.args[0] === "ls-files" ? 512 * 1024 * 1024 : undefined,
        );
      }
    });

    it("skips Git rules with one warning when the enclosing repository ignores the project", async () => {
      const { dependencies, calls, warnings } = fakeGit({
        respond: (args) => isRootCheck(args) ? { success: true, code: 0 } : NOTHING_IGNORED,
      });

      const context = await loadGitIgnoreContext("/repo/app", dependencies);

      assertEquals(context.ignoredPaths, []);
      assertEquals(await context.checkPaths(["index.ts"]), []);
      assertEquals(calls.length, 1, "neither the listing nor candidate checks run");
      assertEquals(warnings, ["/repo/app"]);
    });

    it("resolves rules from the nearest existing directory for a project not created yet", async () => {
      const { dependencies, calls } = fakeGit({
        existing: ["/repo/apps"],
        respond: (args) =>
          args.includes("./web/lib/a.gen.ts")
            ? { success: true, code: 0, stdout: "./web/lib/a.gen.ts\n" }
            : NOTHING_IGNORED,
      });

      const context = await loadGitIgnoreContext("/repo/apps/web", dependencies);

      assertEquals(context.ignoredPaths, []);
      assertEquals(await context.checkPaths(["lib/a.gen.ts", "pages/index.tsx"]), [
        "lib/a.gen.ts",
      ]);
      assertEquals(calls, [
        { args: ["check-ignore", "--quiet", "./web/"], cwd: "/repo/apps" },
        {
          args: [
            "-c",
            "core.quotePath=false",
            "check-ignore",
            "./web/lib/a.gen.ts",
            "./web/pages/index.tsx",
          ],
          cwd: "/repo/apps",
        },
      ]);
    });

    it("applies nothing outside a Git repository", async () => {
      const { dependencies, calls } = fakeGit({
        respond: () => ({ success: false, code: 128, stderr: "fatal: not a git repository" }),
      });

      const context = await loadGitIgnoreContext("/plain", dependencies);

      assertEquals(context.ignoredPaths, []);
      assertEquals(await context.checkPaths(["a.ts"]), []);
      assertEquals(calls.length, 1);
    });

    it("applies nothing when Git is missing and no repository surrounds the project", async () => {
      const { dependencies } = fakeGit({ respond: () => new Error("git: not found") });
      assertEquals((await loadGitIgnoreContext("/plain", dependencies)).ignoredPaths, []);
    });

    it("refuses to continue when Git is missing inside a repository", async () => {
      const { dependencies } = fakeGit({
        respond: () => new Error("git: not found"),
        gitMetadata: true,
      });
      await assertRejects(
        () => loadGitIgnoreContext("/repo", dependencies),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });

    it("refuses to continue when Git fails inside a repository", async () => {
      const { dependencies } = fakeGit({
        respond: (args) =>
          isListing(args)
            ? { success: false, code: 128, stderr: "fatal: detected dubious ownership" }
            : NOTHING_IGNORED,
        gitMetadata: true,
      });
      await assertRejects(
        () => loadGitIgnoreContext("/repo", dependencies),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });

    it("refuses a truncated Git listing", async () => {
      const { dependencies } = fakeGit({
        respond: (args) =>
          isListing(args)
            ? { success: true, code: 0, stdout: ".context/\0", outputTruncated: true }
            : NOTHING_IGNORED,
      });
      await assertRejects(
        () => loadGitIgnoreContext("/repo", dependencies),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });
  });

  describe("GitIgnoreContext.checkPaths", () => {
    it("checks paths that need not exist locally in one git check-ignore call", async () => {
      const { dependencies, calls } = fakeGit({
        respond: (args) =>
          isRootCheck(args)
            ? NOTHING_IGNORED
            : isListing(args) || isIndexListing(args) || isUntrackedListing(args)
            ? { success: true, code: 0, stdout: "" }
            : { success: true, code: 0, stdout: "./dist/app.js\n./:odd.gen.ts\n" },
      });
      const context = await loadGitIgnoreContext("/repo/app", dependencies);

      assertEquals(
        await context.checkPaths(["dist/app.js", "pages/index.tsx", ":odd.gen.ts", "dist/app.js"]),
        ["dist/app.js", ":odd.gen.ts"],
      );
      assertEquals(calls.at(-1), {
        args: [
          "-c",
          "core.quotePath=false",
          "check-ignore",
          "./dist/app.js",
          "./pages/index.tsx",
          "./:odd.gen.ts",
        ],
        cwd: "/repo/app",
      });
    });

    it("splits very long path lists across several calls", async () => {
      const { dependencies, calls } = fakeGit({
        respond: (args) =>
          isListing(args) ? { success: true, code: 0, stdout: "" } : NOTHING_IGNORED,
      });
      const context = await loadGitIgnoreContext("/repo", dependencies);
      const paths = Array.from({ length: 400 }, (_, index) => `${"x".repeat(100)}/${index}.ts`);

      await context.checkPaths(paths);

      const checks = calls.slice(3);
      assertEquals(checks.length > 1, true);
      assertEquals(checks.flatMap((call) => call.args.slice(3)).length, paths.length);
    });

    it("resolves paths in a checked-out submodule against the submodule's own rules", async () => {
      const { dependencies, calls } = fakeGit({
        existing: ["/repo", "/repo/libs/ui", "/repo/libs/ui/.git"],
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isIndexListing(args)) {
            return {
              success: true,
              code: 0,
              stdout: [
                `100644 ${"a".repeat(40)} 0\tapp.ts`,
                `160000 ${"b".repeat(40)} 0\tlibs/ui`,
                "",
              ].join("\0"),
            };
          }
          if (isListing(args) || isUntrackedListing(args)) {
            return { success: true, code: 0, stdout: "" };
          }
          if (args.includes("./secret.gen.ts")) {
            return { success: true, code: 0, stdout: "./secret.gen.ts\n" };
          }
          if (args.includes("./top.gen.ts")) {
            return { success: true, code: 0, stdout: "./top.gen.ts\n" };
          }
          return NOTHING_IGNORED;
        },
      });
      const dependenciesWithChildListing: GitIgnoreDependencies = {
        ...dependencies,
        runCommand: (cmd, commandOptions = {}) =>
          commandOptions.cwd === "/repo/libs/ui" && isListing(commandOptions.args ?? [])
            ? Promise.resolve({ success: true, code: 0, stdout: "cache/\0" })
            : dependencies.runCommand(cmd, commandOptions),
      };

      const context = await loadGitIgnoreContext("/repo", dependenciesWithChildListing);

      assertEquals(context.ignoredPaths, ["libs/ui/cache"]);
      assertEquals(
        await context.checkPaths(["libs/ui/secret.gen.ts", "libs/ui/index.ts", "top.gen.ts"]),
        ["libs/ui/secret.gen.ts", "top.gen.ts"],
      );
      const submoduleCheck = calls.find((call) =>
        call.cwd === "/repo/libs/ui" && call.args.includes("check-ignore") &&
        call.args[0] === "-c"
      );
      assertEquals(submoduleCheck?.args.slice(3), ["./secret.gen.ts", "./index.ts"]);
    });

    it("resolves paths in an untracked nested repository against its own rules", async () => {
      const { dependencies, calls } = fakeGit({
        existing: ["/repo", "/repo/tools", "/repo/tools/.git"],
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isIndexListing(args) || isListing(args)) {
            return { success: true, code: 0, stdout: "" };
          }
          if (isUntrackedListing(args)) {
            return { success: true, code: 0, stdout: "src/a.ts\0tools/\0" };
          }
          if (args.includes("./local.json")) {
            return { success: true, code: 0, stdout: "./local.json\n" };
          }
          return NOTHING_IGNORED;
        },
      });

      const context = await loadGitIgnoreContext("/repo", dependencies);

      assertEquals(
        await context.checkPaths(["tools/local.json", "tools/index.ts", "src/b.ts"]),
        ["tools/local.json"],
      );
      assertEquals(
        calls.some((call) => call.cwd === "/repo/tools" && call.args.includes("./local.json")),
        true,
      );
    });

    it("leaves paths beneath a local symbolic link out of the Git query", async () => {
      const { dependencies, calls } = fakeGit({
        symlinks: ["/repo/linked"],
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isListing(args) || isIndexListing(args) || isUntrackedListing(args)) {
            return { success: true, code: 0, stdout: "" };
          }
          if (args.some((arg) => arg.startsWith("./linked/"))) {
            return {
              success: false,
              code: 128,
              stderr: "fatal: pathspec './linked/file.ts' is beyond a symbolic link",
            };
          }
          return { success: true, code: 0, stdout: "./x.gen.ts\n" };
        },
        gitMetadata: true,
      });
      const context = await loadGitIgnoreContext("/repo", dependencies);

      assertEquals(
        await context.checkPaths(["linked/file.ts", "linked/deep/a.ts", "x.gen.ts"]),
        ["x.gen.ts"],
      );
      assertEquals(calls.at(-1)?.args.slice(3), ["./x.gen.ts"]);
    });

    it("finds a nested repository whose directory also holds parent-tracked files", async () => {
      const { dependencies, calls } = fakeGit({
        existing: ["/repo", "/repo/tools", "/repo/tools/.git"],
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isIndexListing(args) || isListing(args)) {
            return { success: true, code: 0, stdout: "" };
          }
          if (isUntrackedListing(args)) {
            return { success: true, code: 0, stdout: "tools/cred.json\0tools/new.ts\0src/a.ts\0" };
          }
          if (args.includes("./cred.json")) {
            return { success: true, code: 0, stdout: "./cred.json\n" };
          }
          return NOTHING_IGNORED;
        },
      });

      const context = await loadGitIgnoreContext("/repo", dependencies);

      assertEquals(await context.checkPaths(["tools/cred.json", "tools/new.ts"]), [
        "tools/cred.json",
      ]);
      assertEquals(
        calls.some((call) => call.cwd === "/repo/tools" && call.args.includes("./cred.json")),
        true,
      );
    });

    it("finds a nested repository over parent-tracked files with no untracked files", async () => {
      const { dependencies, calls } = fakeGit({
        existing: ["/repo", "/repo/tools", "/repo/tools/.git"],
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isIndexListing(args)) {
            return {
              success: true,
              code: 0,
              stdout: [`100644 ${"a".repeat(40)} 0\ttools/tracked.ts`, ""].join("\0"),
            };
          }
          if (isListing(args) || isUntrackedListing(args)) {
            return { success: true, code: 0, stdout: "" };
          }
          if (args.includes("./remote.json")) {
            return { success: true, code: 0, stdout: "./remote.json\n" };
          }
          return NOTHING_IGNORED;
        },
      });

      const context = await loadGitIgnoreContext("/repo", dependencies);

      assertEquals(await context.checkPaths(["tools/remote.json"]), ["tools/remote.json"]);
      assertEquals(
        calls.some((call) => call.cwd === "/repo/tools" && call.args.includes("./remote.json")),
        true,
      );
    });

    it("drops enclosing ignore matches beneath a nested repository", async () => {
      const { dependencies } = fakeGit({
        existing: ["/repo", "/repo/tools", "/repo/tools/.git"],
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isIndexListing(args)) {
            return {
              success: true,
              code: 0,
              stdout: [`100644 ${"a".repeat(40)} 0\ttools/tracked.ts`, ""].join("\0"),
            };
          }
          if (isUntrackedListing(args)) return { success: true, code: 0, stdout: "" };
          if (isListing(args)) {
            return { success: true, code: 0, stdout: "tools/child-tracked.gen.ts\0top.gen.ts\0" };
          }
          return NOTHING_IGNORED;
        },
      });
      const outerListing = dependencies.runCommand;
      const context = await loadGitIgnoreContext("/repo", {
        ...dependencies,
        runCommand: (cmd, commandOptions = {}) =>
          commandOptions.cwd === "/repo/tools" && isListing(commandOptions.args ?? [])
            ? Promise.resolve({ success: true, code: 0, stdout: "cache/\0" })
            : outerListing(cmd, commandOptions),
      });

      assertEquals([...context.ignoredPaths].sort(), ["tools/cache", "top.gen.ts"]);
    });

    it("drops a whole submodule named from the repository root in one retry", async () => {
      const { dependencies, calls } = fakeGit({
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isListing(args) || isIndexListing(args) || isUntrackedListing(args)) {
            return { success: true, code: 0, stdout: "" };
          }
          if (args[0] === "rev-parse") return { success: true, code: 0, stdout: "apps/proj/\n" };
          const inSubmodule = args.find((arg) => arg.startsWith("./vendor/sub/"));
          if (inSubmodule) {
            return {
              success: false,
              code: 128,
              stderr: `fatal: Pathspec '${inSubmodule}' is in submodule 'apps/proj/vendor/sub'`,
            };
          }
          return { success: true, code: 0, stdout: "./x.gen.ts\n" };
        },
        gitMetadata: true,
      });
      const context = await loadGitIgnoreContext("/repo/apps/proj", dependencies);
      const paths = Array.from({ length: 50 }, (_, index) => `vendor/sub/file-${index}.ts`);

      assertEquals(await context.checkPaths([...paths, "x.gen.ts"]), ["x.gen.ts"]);
      const checks = calls.filter((call) => call.args[0] === "-c");
      assertEquals(checks.length, 2);
      assertEquals(checks.at(-1)?.args.slice(3), ["./x.gen.ts"]);
    });

    it("drops paths inside a submodule and checks the rest again", async () => {
      const { dependencies, calls } = fakeGit({
        respond: (args) => {
          if (isRootCheck(args)) return NOTHING_IGNORED;
          if (isListing(args)) return { success: true, code: 0, stdout: "" };
          if (args.some((arg) => arg.startsWith("./sub/"))) {
            return {
              success: false,
              code: 128,
              stderr: "fatal: Pathspec './sub/a.ts' is in submodule 'sub'",
            };
          }
          return { success: true, code: 0, stdout: "./x.gen.ts\n" };
        },
        gitMetadata: true,
      });
      const context = await loadGitIgnoreContext("/repo", dependencies);

      assertEquals(await context.checkPaths(["sub/a.ts", "sub/b.gen.ts", "x.gen.ts"]), [
        "x.gen.ts",
      ]);
      assertEquals(calls.at(-1)?.args.slice(3), ["./x.gen.ts"]);
    });

    it("refuses to continue when a check fails inside a repository", async () => {
      const { dependencies } = fakeGit({
        respond: (args) =>
          isRootCheck(args)
            ? NOTHING_IGNORED
            : isListing(args) || isIndexListing(args) || isUntrackedListing(args)
            ? { success: true, code: 0, stdout: "" }
            : { success: false, code: 128, stderr: "fatal: detected dubious ownership" },
        gitMetadata: true,
      });
      const context = await loadGitIgnoreContext("/repo", dependencies);

      await assertRejects(
        () => context.checkPaths(["a.ts"]),
        Error,
        "Could not read Git ignore rules for this project.",
      );
    });
  });

  describe("trimTrailingSlashes", () => {
    it("removes only trailing slashes", () => {
      assertEquals(trimTrailingSlashes("dist///"), "dist");
      assertEquals(trimTrailingSlashes("a/b"), "a/b");
      assertEquals(trimTrailingSlashes("/"), "");
      assertEquals(trimTrailingSlashes(""), "");
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

    it("walks into a wholly Git-ignored directory only when a negation can reach inside", () => {
      const checker = createIgnoreChecker(["!generated/data.json"], {
        gitIgnoredPaths: ["generated", "cache"],
      });

      assertEquals(checker.isIgnored("generated", { isDirectory: true }), false);
      assertEquals(checker.isIgnored("generated/data.json"), false);
      assertEquals(checker.isIgnored("generated/other.json"), true);

      const anchored = createIgnoreChecker(["!/generated/data.json"], {
        gitIgnoredPaths: ["generated", "cache"],
      });
      assertEquals(anchored.isIgnored("generated", { isDirectory: true }), false);
      assertEquals(anchored.isIgnored("cache", { isDirectory: true }), true);

      const withoutNegation = createIgnoreChecker([], { gitIgnoredPaths: ["generated"] });
      assertEquals(withoutNegation.isIgnored("generated", { isDirectory: true }), true);
    });

    it("keeps protected paths ignored regardless of Git", () => {
      const checker = createIgnoreChecker(["!.env.local"], { gitIgnoredPaths: [] });
      assertEquals(checker.isIgnored(".env.local"), true);
    });
  });

  describe("resolveGitIgnoredCandidates", () => {
    it("asks Git once per path and ignores the matches", async () => {
      const asked: string[][] = [];
      const checker = createIgnoreChecker(["!generated/keep.ts"], {
        checkGitIgnoredPaths: (paths) => {
          asked.push(paths);
          return Promise.resolve(
            paths.filter((path) => path.startsWith("generated/") || path === "remote.gen.ts"),
          );
        },
      });

      await checker.resolveGitIgnoredCandidates([
        "generated/remote-only.ts",
        "generated/keep.ts",
        "pages/index.tsx",
        "remote.gen.ts",
      ]);
      await checker.resolveGitIgnoredCandidates(["pages/index.tsx", "lib/new.ts"]);

      assertEquals(asked, [
        ["generated/remote-only.ts", "generated/keep.ts", "pages/index.tsx", "remote.gen.ts"],
        ["lib/new.ts"],
      ]);
      assertEquals(checker.isIgnored("generated/remote-only.ts"), true);
      assertEquals(checker.isIgnored("remote.gen.ts"), true);
      assertEquals(checker.isIgnored("generated/keep.ts"), false);
      assertEquals(checker.isIgnored("pages/index.tsx"), false);
    });

    it("refreshes Git ignore state in place and rechecks resolved candidates", async () => {
      let generation = 0;
      const asked: string[][] = [];
      const checker = createIgnoreChecker(["!generated/keep.ts"], {
        gitIgnoredPaths: ["generated"],
        checkGitIgnoredPaths: (paths) => {
          asked.push(paths);
          return Promise.resolve(paths.filter((path) => path === "remote.gen.ts"));
        },
        loadGitIgnoreContext: () => {
          generation++;
          return Promise.resolve({
            ignoredPaths: ["cache"],
            checkPaths: (paths: Iterable<string>) => {
              asked.push([...paths]);
              return Promise.resolve([...paths].filter((path) => path === "other.gen.ts"));
            },
          });
        },
      });
      await checker.resolveGitIgnoredCandidates(["remote.gen.ts", "other.gen.ts"]);
      assertEquals(checker.isIgnored("remote.gen.ts"), true);
      assertEquals(checker.isIgnored("generated/other.ts"), true);

      await checker.refreshGitIgnores();

      assertEquals(generation, 1);
      assertEquals(asked.at(-1), ["remote.gen.ts", "other.gen.ts"]);
      assertEquals(checker.isIgnored("remote.gen.ts"), false);
      assertEquals(checker.isIgnored("other.gen.ts"), true);
      assertEquals(checker.isIgnored("generated/other.ts"), false);
      assertEquals(checker.isIgnored("cache/entry.ts"), true);
      assertEquals(checker.isIgnored("generated/keep.ts"), false);
    });

    it("does nothing for a checker without Git context", async () => {
      const checker = createDefaultIgnoreChecker();
      await checker.resolveGitIgnoredCandidates(["generated/remote-only.ts"]);
      assertEquals(checker.isIgnored("generated/remote-only.ts"), false);
      await checker.refreshGitIgnores();
      assertEquals(checker.isIgnored("generated/remote-only.ts"), false);
    });
  });

  it("ignores .context by default outside Git", () => {
    const checker = createDefaultIgnoreChecker();
    assertEquals(checker.isIgnored(".context", { isDirectory: true }), true);
    assertEquals(checker.isIgnored(".context/todos.md"), true);
  });
});
