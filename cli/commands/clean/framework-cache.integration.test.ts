import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { exists, mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { setEnv } from "#veryfront/compat/process.ts";
import { getProjectCacheDir } from "veryfront/utils/cache-dir";
import { cleanCommand } from "./index.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";

/**
 * A dev server keeps compiled modules in the framework cache root, which is
 * separate from the render cache store the config points at. A `--cache` clean
 * that leaves those entries in place reports success while the disk usage and
 * the stale modules stay.
 */
describe("CLI clean command framework cache", () => {
  it("removes the framework cache root", async () => {
    await withTestContext("cli-clean-framework-cache", async (context) => {
      setEnv("VF_CACHE_ALLOW_CLOSE", "1");

      const frameworkCacheDir = getProjectCacheDir(context.projectDir);
      const compiledModule = join(frameworkCacheDir, "veryfront-files", "entry.vfcache");
      await mkdir(join(frameworkCacheDir, "veryfront-files"), { recursive: true });
      await writeTextFile(compiledModule, "compiled");

      await cleanCommand({ projectDir: context.projectDir, cache: true, force: true });

      assertEquals(await exists(compiledModule), false);
    });
  });
});
