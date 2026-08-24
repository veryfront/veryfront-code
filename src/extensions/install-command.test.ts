import { withTempDir } from "#veryfront/testing/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import {
  detectProjectInstallTarget,
  formatInstallCommand,
  runtimeInstallTarget,
} from "./install-command.ts";
import { getRecommendation } from "./recommendations.ts";

describe("extensions/install-command", () => {
  it("prefixes the npm registry for Deno, which otherwise resolves to JSR", () => {
    // `deno add @veryfront/ext-css-lightning` exits with
    // "@veryfront/ext-css-lightning is missing a prefix" because Deno reads an
    // unprefixed specifier as JSR, and jsr.io hosts no `@veryfront` scope.
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "deno"),
      "deno add npm:@veryfront/ext-css-lightning",
    );
  });

  it("uses the client that owns the project for npm, Bun, pnpm, and Yarn", () => {
    // Spelled out as literals: a formatter that regressed must not be able to
    // satisfy this by agreeing with itself.
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "npm"),
      "npm install @veryfront/ext-css-lightning",
    );
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "bun"),
      "bun add @veryfront/ext-css-lightning",
    );
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "pnpm"),
      "pnpm add @veryfront/ext-css-lightning",
    );
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "yarn"),
      "yarn add @veryfront/ext-css-lightning",
    );
  });

  it("never doubles an npm: prefix a recommendation already carries", () => {
    // `RedisRuntimeProvider` is recorded as `npm:@veryfront/ext-redis`, so a
    // caller that pasted the value straight into a command would emit
    // `npm install npm:@veryfront/ext-redis`.
    const recorded = getRecommendation("RedisRuntimeProvider");
    assertEquals(recorded, "npm:@veryfront/ext-redis");
    assertEquals(
      formatInstallCommand(recorded ?? "", "npm"),
      "npm install @veryfront/ext-redis",
    );
    assertEquals(
      formatInstallCommand(recorded ?? "", "deno"),
      "deno add npm:@veryfront/ext-redis",
    );
  });

  it("follows the project manifest, not the runtime running the build", async () => {
    // The compiled Deno binary builds `--runtime node` scaffolds. Telling one
    // of those to run `deno add` writes a deno.json that the project's own
    // `npm ci` ignores, so the optimizer is lost on the next Node build.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"npm-scaffold"}`);
      assertEquals(detectProjectInstallTarget(directory), "npm");
      assertEquals(
        formatInstallCommand(
          "@veryfront/ext-css-lightning",
          detectProjectInstallTarget(directory) ?? runtimeInstallTarget(),
        ),
        "npm install @veryfront/ext-css-lightning",
      );
    });
  });

  it("reads the more specific manifest a Deno or Bun project keeps beside package.json", async () => {
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"both"}`);
      await writeTextFile(join(directory, "deno.json"), `{"nodeModulesDir":"auto"}`);
      assertEquals(detectProjectInstallTarget(directory), "deno");

      await writeTextFile(join(directory, "bun.lock"), "");
      assertEquals(detectProjectInstallTarget(directory), "bun");
    });
  });

  it("reads the lockfile, not package.json, to name the npm-family client", async () => {
    // `package.json` alone cannot distinguish npm from pnpm or Yarn. Printing
    // `npm install` into either writes a second, conflicting
    // `package-lock.json` and leaves the real lockfile stale, so the next
    // frozen-lockfile CI run rejects the change.
    for (
      const [lockfile, target, command] of [
        ["pnpm-lock.yaml", "pnpm", "pnpm add @veryfront/ext-css-lightning"],
        ["yarn.lock", "yarn", "yarn add @veryfront/ext-css-lightning"],
        ["package-lock.json", "npm", "npm install @veryfront/ext-css-lightning"],
        ["deno.lock", "deno", "deno add npm:@veryfront/ext-css-lightning"],
      ] as const
    ) {
      await withTempDir(async (directory) => {
        await writeTextFile(join(directory, "package.json"), `{"name":"member"}`);
        await writeTextFile(join(directory, lockfile), "");
        assertEquals(detectProjectInstallTarget(directory), target);
        assertEquals(
          formatInstallCommand("@veryfront/ext-css-lightning", target),
          command,
        );
      });
    }
  });

  it("finds the workspace-root lockfile a pnpm or Yarn member does not keep", async () => {
    // pnpm and Yarn workspaces hold one lockfile at the repository root; the
    // member directory the build runs in has only a `package.json`.
    await withTempDir(async (root) => {
      await writeTextFile(join(root, "package.json"), `{"name":"root"}`);
      await writeTextFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const member = join(root, "packages", "app");
      await mkdir(member, { recursive: true });
      await writeTextFile(join(member, "package.json"), `{"name":"app"}`);

      assertEquals(detectProjectInstallTarget(member), "pnpm");
      assertEquals(
        formatInstallCommand("@veryfront/ext-css-lightning", "pnpm"),
        "pnpm add @veryfront/ext-css-lightning",
      );
    });
  });

  it("finds the workspace-root lockfile from the deepest documented member nesting", async () => {
    // The documented reach is `<root>/<group>/<scope>/<member>`; a member that
    // deep must still resolve to the workspace client, not print `npm install`
    // into a pnpm workspace.
    await withTempDir(async (root) => {
      await writeTextFile(join(root, "package.json"), `{"name":"root"}`);
      await writeTextFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const member = join(root, "group", "scope", "member");
      await mkdir(member, { recursive: true });
      await writeTextFile(join(member, "package.json"), `{"name":"member"}`);

      assertEquals(
        detectProjectInstallTarget(member),
        "pnpm",
        "a pnpm member three directories below the workspace root must resolve to pnpm",
      );
    });
  });

  it("does not let an enclosing deno.lock claim a Node package", async () => {
    // A `--runtime node` scaffold checked out inside a Deno repository is still
    // a Node project. `deno add` there writes a deno.json its own `npm ci`
    // ignores, which is the failure this module exists to avoid.
    await withTempDir(async (root) => {
      await writeTextFile(join(root, "deno.json"), `{"name":"@scope/repo"}`);
      await writeTextFile(join(root, "deno.lock"), `{"version":"5"}`);
      const scaffold = join(root, "examples", "node-app");
      await mkdir(scaffold, { recursive: true });
      await writeTextFile(join(scaffold, "package.json"), `{"name":"node-app"}`);

      assertEquals(detectProjectInstallTarget(scaffold), "npm");
    });
  });

  it("keeps a member's own lockfile ahead of the workspace root's", async () => {
    await withTempDir(async (root) => {
      await writeTextFile(join(root, "package.json"), `{"name":"root"}`);
      await writeTextFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const member = join(root, "standalone");
      await mkdir(member, { recursive: true });
      await writeTextFile(join(member, "package.json"), `{"name":"standalone"}`);
      await writeTextFile(join(member, "package-lock.json"), `{"lockfileVersion":3}`);

      assertEquals(detectProjectInstallTarget(member), "npm");
    });
  });

  it("reports no target when the directory holds no manifest", async () => {
    await withTempDir((directory) => {
      assertEquals(detectProjectInstallTarget(directory), undefined);
      return Promise.resolve();
    });
  });

  it("falls back to the client that ships with the runtime", () => {
    assertEquals(runtimeInstallTarget("deno"), "deno");
    assertEquals(runtimeInstallTarget("bun"), "bun");
    assertEquals(runtimeInstallTarget("node"), "npm");
    assertEquals(runtimeInstallTarget("cloudflare"), "npm");
    assertEquals(runtimeInstallTarget("unknown"), "npm");
  });
});
