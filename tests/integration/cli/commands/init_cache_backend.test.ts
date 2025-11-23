import { assertMatch } from "std/assert/assert_match.ts";
import { assert } from "std/assert/assert.ts";
import { assertStringIncludes } from "std/assert/assert_string_includes.ts";
import { describe, it } from "std/testing/bdd.ts";
import { join } from "std/path/mod.ts";
import { initCommand } from "../../../../src/cli/commands/init/index.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

function readConfig(path: string): Promise<string> {
  return Deno.readTextFile(join(path, "veryfront.config.js"));
}

describe("CLI init cache backend configuration", () => {
  it("defaults cache.render.type to memory for legacy templates", async () => {
    await withTestContext("cli-init-cache-default", async (context: TestContext) => {
      const previousCwd = Deno.cwd();
      try {
        Deno.chdir(context.projectDir);
        // Explicitly pass cacheBackend: "memory" to avoid stdin prompt in tests
        await initCommand({ name: "legacy-app", template: "pages-router", cacheBackend: "memory" });
      } finally {
        Deno.chdir(previousCwd);
      }

      const config = await readConfig(join(context.projectDir, "legacy-app"));
      assertMatch(
        config,
        /cache:\s*\{[\s\S]*?render:\s*\{[\s\S]*?type:\s*"memory"/,
      );
    });
  });

  it("writes the selected cache backend into new template configs", async () => {
    await withTestContext("cli-init-cache-redis", async (context: TestContext) => {
      const previousCwd = Deno.cwd();
      try {
        Deno.chdir(context.projectDir);
        await initCommand({
          name: "app-template",
          template: "app",
          cacheBackend: "redis",
        });
      } finally {
        Deno.chdir(previousCwd);
      }

      const config = await readConfig(join(context.projectDir, "app-template"));
      assertMatch(
        config,
        /cache:\s*\{[\s\S]*?render:\s*\{[\s\S]*?type:\s*"redis"/,
      );
      assert(
        !config.includes('? "redis" : "memory"'),
        "expected dynamic redis fallback to be replaced with static backend",
      );
      assertStringIncludes(config, "redisUrl");
    });
  });
});
