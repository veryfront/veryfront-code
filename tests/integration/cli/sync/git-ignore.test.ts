import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { scanLocalFiles } from "../../../../cli/commands/push/command.ts";
import { loadGitIgnoreContext } from "../../../../cli/sync/git-ignore.ts";
import { loadIgnoreChecker } from "../../../../cli/sync/ignore.ts";
import { setJsonMode } from "../../../../cli/shared/json-output.ts";

async function runGit(cwd: string, ...args: string[]): Promise<void> {
  const result = await new Deno.Command("git", {
    args,
    cwd,
    clearEnv: true,
    env: {
      ...Object.fromEntries(
        Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
      ),
      GIT_CONFIG_NOSYSTEM: "1",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
}

async function writeFile(root: string, path: string, content = "x"): Promise<void> {
  const fullPath = `${root}/${path}`;
  await Deno.mkdir(fullPath.slice(0, fullPath.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(fullPath, content);
}

/**
 * A repository whose ignore rules come from every source Git reads: a root
 * `.gitignore`, a nested `.gitignore`, `.git/info/exclude`, and
 * `core.excludesFile`. The Veryfront project lives in `app/`.
 */
async function createIgnoringRepository(repoDir: string): Promise<string> {
  await runGit(repoDir, "init", "-q");
  await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.gen.ts\n");
  await Deno.writeTextFile(`${repoDir}/.git/info/exclude`, ".context/\n");
  await Deno.writeTextFile(`${repoDir}/global-excludes`, "scratch.md\n");
  await runGit(repoDir, "config", "core.excludesFile", `${repoDir}/global-excludes`);

  const projectDir = `${repoDir}/app`;
  await writeFile(projectDir, "pages/index.tsx");
  await writeFile(projectDir, "pages/types.gen.ts");
  await writeFile(projectDir, "pages/tracked.gen.ts");
  await writeFile(projectDir, ".context/todos.md");
  await writeFile(projectDir, ".context/attachments/note.md");
  await writeFile(projectDir, "scratch.md");
  await writeFile(projectDir, "content/.gitignore", "drafts/\n");
  await writeFile(projectDir, "content/post.md");
  await writeFile(projectDir, "content/drafts/wip.md");
  await runGit(repoDir, "add", "-f", "app/pages/tracked.gen.ts");
  return projectDir;
}

describe("cli/sync/git-ignore against real Git", () => {
  describe("loadGitIgnoreContext", () => {
    it("applies nothing outside a Git repository", async () => {
      await withTempDir(async (projectDir) => {
        await writeFile(projectDir, ".context/todos.md");
        const context = await loadGitIgnoreContext(projectDir);
        assertEquals(context.ignoredPaths, []);
        assertEquals(await context.checkPaths(["dist/app.js"]), []);
      });
    });

    it("lists paths from .gitignore, info/exclude, and core.excludesFile relative to the project", async () => {
      await withTempDir(async (repoDir) => {
        const projectDir = await createIgnoringRepository(repoDir);

        assertEquals([...(await loadGitIgnoreContext(projectDir)).ignoredPaths].sort(), [
          ".context",
          "content/drafts",
          "pages/types.gen.ts",
          "scratch.md",
        ]);
      });
    });

    it("skips Git rules when the enclosing repository ignores the project directory", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "app/\n*.gen.ts\n");
        await writeFile(repoDir, "app/web/pages/index.tsx");
        await writeFile(repoDir, "app/web/lib/types.gen.ts");

        for (const projectDir of [`${repoDir}/app`, `${repoDir}/app/web`]) {
          const context = await loadGitIgnoreContext(projectDir);
          assertEquals(context.ignoredPaths, []);
          assertEquals(await context.checkPaths(["lib/remote.gen.ts"]), []);
        }

        const files = await scanLocalFiles(
          `${repoDir}/app/web`,
          await loadIgnoreChecker(`${repoDir}/app/web`),
        );
        assertEquals(files.map((file) => file.path).sort(), [
          "lib/types.gen.ts",
          "pages/index.tsx",
        ]);
      });
    });

    it("emits a structured warning in JSON mode when Git rules are skipped", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "app/\n");
        await writeFile(repoDir, "app/pages/index.tsx");

        const output: string[] = [];
        const originalLog = console.log;
        console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
        setJsonMode(true);
        try {
          await loadGitIgnoreContext(`${repoDir}/app`);
        } finally {
          setJsonMode(false);
          console.log = originalLog;
        }

        assertEquals(output.map((line) => JSON.parse(line)), [{
          type: "warning",
          code: "git-ignore-rules-not-applied",
          message:
            "Project directory is ignored by the enclosing Git repository; Git ignore rules were not applied. Default ignores and .vfignore still apply.",
        }]);
      });
    });

    it("checks remote paths without failing on a local directory symlink", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.gen.ts\n");
        await Deno.mkdir(`${repoDir}/elsewhere`);
        await Deno.symlink(`${repoDir}/elsewhere`, `${repoDir}/linked`);

        const context = await loadGitIgnoreContext(repoDir);
        assertEquals(
          await context.checkPaths(["linked/file.ts", "linked/remote.gen.ts", "lib/a.gen.ts"]),
          ["lib/a.gen.ts"],
        );
      });
    });

    it("resolves the enclosing repository's rules for a project directory not created yet", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.gen.ts\ngenerated/\n");
        await Deno.mkdir(`${repoDir}/apps`);

        const context = await loadGitIgnoreContext(`${repoDir}/apps/web/site`);

        assertEquals(context.ignoredPaths, []);
        assertEquals(
          (await context.checkPaths([
            "lib/remote.gen.ts",
            "generated/data.json",
            "pages/index.tsx",
          ])).sort(),
          ["generated/data.json", "lib/remote.gen.ts"],
        );
      });
    });
  });

  describe("GitIgnoreContext.checkPaths", () => {
    it("matches paths that do not exist locally and skips tracked files", async () => {
      await withTempDir(async (repoDir) => {
        const projectDir = await createIgnoringRepository(repoDir);
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.gen.ts\ndist/\n");

        const ignored = await (await loadGitIgnoreContext(projectDir)).checkPaths([
          "dist/app.js",
          "lib/remote-only.gen.ts",
          ".context/new-note.md",
          "content/drafts/remote.md",
          "pages/tracked.gen.ts",
          "pages/about.tsx",
          ":colon.gen.ts",
          "-dash.gen.ts",
          "space name.gen.ts",
        ]);

        assertEquals(ignored.sort(), [
          "-dash.gen.ts",
          ".context/new-note.md",
          ":colon.gen.ts",
          "content/drafts/remote.md",
          "dist/app.js",
          "lib/remote-only.gen.ts",
          "space name.gen.ts",
        ]);
      });
    });
  });

  describe("submodules", () => {
    it("applies a checked-out submodule's own ignore rules to local and remote paths", async () => {
      await withTempDir(async (root) => {
        const childRepo = `${root}/child`;
        await Deno.mkdir(childRepo);
        await runGit(childRepo, "init", "-q");
        await Deno.writeTextFile(`${childRepo}/.gitignore`, "*.gen.ts\n");
        await writeFile(childRepo, "index.ts");
        await runGit(childRepo, "add", ".");
        await runGit(
          childRepo,
          "-c",
          "user.email=test@veryfront.com",
          "-c",
          "user.name=Veryfront Test",
          "commit",
          "-qm",
          "child",
        );

        const repoDir = `${root}/parent`;
        await Deno.mkdir(repoDir);
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.tmp.ts\n");
        await runGit(
          repoDir,
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          "-q",
          childRepo,
          "libs/ui",
        );
        await writeFile(repoDir, "pages/index.tsx");
        await writeFile(repoDir, "libs/ui/local.gen.ts");

        const context = await loadGitIgnoreContext(repoDir);
        assertEquals(context.ignoredPaths.includes("libs/ui/local.gen.ts"), true);
        assertEquals(
          (await context.checkPaths([
            "libs/ui/remote.gen.ts",
            "libs/ui/index.ts",
            "draft.tmp.ts",
            "pages/about.tsx",
          ])).sort(),
          ["draft.tmp.ts", "libs/ui/remote.gen.ts"],
        );

        const files = await scanLocalFiles(repoDir, await loadIgnoreChecker(repoDir));
        assertEquals(
          files.map((file) => file.path).filter((path) =>
            path.endsWith(".ts") || path.endsWith(".tsx")
          )
            .sort(),
          ["libs/ui/index.ts", "pages/index.tsx"],
        );
      });
    });
  });

  describe("nested repositories", () => {
    it("applies an untracked nested repository's own ignore rules", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await writeFile(repoDir, "pages/index.tsx");
        const nestedDir = `${repoDir}/tools/cli`;
        await Deno.mkdir(nestedDir, { recursive: true });
        await runGit(nestedDir, "init", "-q");
        await Deno.writeTextFile(`${nestedDir}/.gitignore`, "credentials.json\n");
        await writeFile(nestedDir, "index.ts");
        await writeFile(nestedDir, "credentials.json", "{}");

        const context = await loadGitIgnoreContext(repoDir);
        assertEquals(context.ignoredPaths.includes("tools/cli/credentials.json"), true);
        assertEquals(
          await context.checkPaths(["tools/cli/credentials.json", "tools/cli/remote.ts"]),
          ["tools/cli/credentials.json"],
        );

        const files = await scanLocalFiles(repoDir, await loadIgnoreChecker(repoDir));
        assertEquals(files.map((file) => file.path).sort(), [
          "pages/index.tsx",
          "tools/cli/index.ts",
        ]);
      });
    });
    it("applies a nested repository's rules to remote paths when it has no untracked files", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await writeFile(repoDir, "tools/tracked.ts");
        await runGit(repoDir, "add", ".");
        await runGit(`${repoDir}/tools`, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/tools/.git/info/exclude`, "remote.json\n");

        const context = await loadGitIgnoreContext(repoDir);
        assertEquals(await context.checkPaths(["tools/remote.json", "tools/other.json"]), [
          "tools/remote.json",
        ]);
      });
    });

    it("keeps a file the nested repository tracks even when the parent ignores it", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.gen.ts\n");
        await writeFile(repoDir, "tools/tracked.ts");
        await runGit(repoDir, "add", ".");
        await runGit(`${repoDir}/tools`, "init", "-q");
        await writeFile(repoDir, "tools/schema.gen.ts");
        await runGit(`${repoDir}/tools`, "add", "schema.gen.ts");

        const files = await scanLocalFiles(repoDir, await loadIgnoreChecker(repoDir));
        assertEquals(files.map((file) => file.path).sort(), [
          "tools/schema.gen.ts",
          "tools/tracked.ts",
        ]);
      });
    });

    it("applies a nested repository's rules when the parent also tracks files there", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await writeFile(repoDir, "tools/tracked.ts");
        await runGit(repoDir, "add", ".");
        await runGit(`${repoDir}/tools`, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/tools/.git/info/exclude`, "cred.json\n");
        await writeFile(repoDir, "tools/cred.json", "{}");
        await writeFile(repoDir, "tools/new.ts");

        const context = await loadGitIgnoreContext(repoDir);
        assertEquals(context.ignoredPaths.includes("tools/cred.json"), true);

        const files = await scanLocalFiles(repoDir, await loadIgnoreChecker(repoDir));
        assertEquals(files.map((file) => file.path).sort(), ["tools/new.ts", "tools/tracked.ts"]);
      });
    });
  });

  describe("scanLocalFiles with loadIgnoreChecker", () => {
    it("skips files Git ignores through info/exclude and keeps tracked files", async () => {
      await withTempDir(async (repoDir) => {
        const projectDir = await createIgnoringRepository(repoDir);
        // Drop the `.context` default so only `.git/info/exclude` can hide it.
        await Deno.writeTextFile(`${projectDir}/.vfignore`, "!.context\n");

        const withNegation = await scanLocalFiles(projectDir, await loadIgnoreChecker(projectDir));
        assertEquals(
          withNegation.map((file) => file.path).includes(".context/todos.md"),
          true,
          "a .vfignore negation re-includes a Git-ignored path",
        );

        await Deno.remove(`${projectDir}/.vfignore`);
        const files = await scanLocalFiles(projectDir, await loadIgnoreChecker(projectDir));
        assertEquals(files.map((file) => file.path).sort(), [
          "content/post.md",
          "pages/index.tsx",
          "pages/tracked.gen.ts",
        ]);
      });
    });

    it("excludes a Git-ignored file created after the checker was loaded", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.gen.ts\ngenerated/\n");
        await writeFile(repoDir, "pages/index.tsx");

        const checker = await loadIgnoreChecker(repoDir);
        await writeFile(repoDir, "lib/late.gen.ts");
        await writeFile(repoDir, "generated/late.ts");
        await writeFile(repoDir, "lib/late.ts");

        const files = await scanLocalFiles(repoDir, checker);
        assertEquals(files.map((file) => file.path).sort(), ["lib/late.ts", "pages/index.tsx"]);
      });
    });

    it("skips a Git-ignored symbolic link created after the checker was loaded", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "linked.ts\n");
        await writeFile(repoDir, "pages/index.tsx");
        await writeFile(repoDir, "target.ts");

        const checker = await loadIgnoreChecker(repoDir);
        await Deno.symlink(`${repoDir}/target.ts`, `${repoDir}/linked.ts`);

        const files = await scanLocalFiles(repoDir, checker);
        assertEquals(files.map((file) => file.path).sort(), ["pages/index.tsx", "target.ts"]);

        await Deno.symlink(`${repoDir}/target.ts`, `${repoDir}/other-link.ts`);
        await assertRejects(
          () => scanLocalFiles(repoDir, checker),
          Error,
          'does not support symbolic links: "other-link.ts"',
        );
      });
    });

    it("includes a file Git stopped ignoring after the checker was loaded", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "*.gen.ts\nforced/\n");
        await writeFile(repoDir, "pages/index.tsx");
        await writeFile(repoDir, "lib/types.gen.ts");
        await writeFile(repoDir, "forced/data.ts");

        const checker = await loadIgnoreChecker(repoDir);
        await checker.resolveGitIgnoredCandidates(["remote/only.gen.ts"]);
        assertEquals(checker.isIgnored("remote/only.gen.ts"), true);
        assertEquals(
          (await scanLocalFiles(repoDir, checker)).map((file) => file.path).sort(),
          ["pages/index.tsx"],
        );

        await Deno.writeTextFile(`${repoDir}/.gitignore`, "forced/\n");
        await runGit(repoDir, "add", "-f", "forced/data.ts");

        const files = await scanLocalFiles(repoDir, checker);
        assertEquals(files.map((file) => file.path).sort(), [
          "forced/data.ts",
          "lib/types.gen.ts",
          "pages/index.tsx",
        ]);
        assertEquals(
          checker.isIgnored("remote/only.gen.ts"),
          false,
          "remote classification follows the refreshed rules too",
        );
      });
    });

    it("re-includes a file inside a directory Git ignores as a whole", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.gitignore`, "generated/\n");
        await Deno.writeTextFile(`${repoDir}/.vfignore`, "!generated/data.json\n");
        await writeFile(repoDir, "pages/index.tsx");
        await writeFile(repoDir, "generated/data.json");
        await writeFile(repoDir, "generated/other.json");
        await writeFile(repoDir, "generated/nested/deep.json");

        const files = await scanLocalFiles(repoDir, await loadIgnoreChecker(repoDir));
        assertEquals(files.map((file) => file.path).sort(), [
          "generated/data.json",
          "pages/index.tsx",
        ]);
      });
    });

    it("skips info/exclude entries that the defaults do not cover", async () => {
      await withTempDir(async (repoDir) => {
        await runGit(repoDir, "init", "-q");
        await Deno.writeTextFile(`${repoDir}/.git/info/exclude`, ".conductor/\n");
        await writeFile(repoDir, "pages/index.tsx");
        await writeFile(repoDir, ".conductor/todos.md");

        const files = await scanLocalFiles(repoDir, await loadIgnoreChecker(repoDir));
        assertEquals(files.map((file) => file.path), ["pages/index.tsx"]);
      });
    });
  });
});
