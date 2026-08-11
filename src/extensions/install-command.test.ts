import { withTempDir } from "#veryfront/testing/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
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

  it("uses the client that owns the project for npm and Bun", () => {
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "npm"),
      "npm install @veryfront/ext-css-lightning",
    );
    assertEquals(
      formatInstallCommand("@veryfront/ext-css-lightning", "bun"),
      "bun add @veryfront/ext-css-lightning",
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
