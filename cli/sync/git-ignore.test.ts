import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { scanLocalFiles } from "../commands/push/command.ts";
import { loadGitIgnoredPaths } from "./git-ignore.ts";
import { createDefaultIgnoreChecker, createIgnoreChecker, loadIgnoreChecker } from "./ignore.ts";

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

describe("cli/sync/git-ignore", () => {
  describe("loadGitIgnoredPaths", () => {
    it("returns no paths outside a Git repository", async () => {
      await withTempDir(async (projectDir) => {
        await writeFile(projectDir, ".context/todos.md");
        assertEquals(await loadGitIgnoredPaths(projectDir), []);
      });
    });

    it("returns no paths for a project directory that does not exist yet", async () => {
      await withTempDir(async (root) => {
        assertEquals(await loadGitIgnoredPaths(`${root}/missing`), []);
      });
    });

    it("lists paths from .gitignore, info/exclude, and core.excludesFile relative to the project", async () => {
      await withTempDir(async (repoDir) => {
        const projectDir = await createIgnoringRepository(repoDir);

        assertEquals((await loadGitIgnoredPaths(projectDir)).sort(), [
          ".context",
          "content/drafts",
          "pages/types.gen.ts",
          "scratch.md",
        ]);
      });
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

  describe("scanLocalFiles with loadIgnoreChecker", () => {
    it("skips files Git ignores through info/exclude and keeps tracked files", async () => {
      await withTempDir(async (repoDir) => {
        const projectDir = await createIgnoringRepository(repoDir);
        // Drop the `.context` default so only `.git/info/exclude` can hide it.
        await Deno.writeTextFile(`${projectDir}/.vfignore`, "!.context\n");
        await Deno.writeTextFile(`${repoDir}/.git/info/exclude`, ".context/\n");

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
