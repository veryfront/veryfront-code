import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
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
  it("removes Veryfront cache data without deleting unrelated cache siblings", async () => {
    await withTestContext("cli-clean-framework-cache", async (context) => {
      context.setEnv({ VF_CACHE_ALLOW_CLOSE: "1" });

      const frameworkCacheDir = getProjectCacheDir(context.projectDir);
      const compiledModule = join(frameworkCacheDir, "veryfront-files", "entry.vfcache");
      const mdxModule = join(frameworkCacheDir, "veryfront-mdx-esm", "page.mjs");
      const httpBundle = join(frameworkCacheDir, "veryfront-http-bundle", "react.mjs");
      const transformedModule = join(frameworkCacheDir, "veryfront-modules", "page.js");
      const cycleManifest = join(
        frameworkCacheDir,
        "veryfront-cycle-manifests",
        "cycle.json",
      );
      const unrelatedCache = join(frameworkCacheDir, "other-tool", "keep.txt");
      await mkdir(join(frameworkCacheDir, "veryfront-files"), { recursive: true });
      await mkdir(join(frameworkCacheDir, "veryfront-mdx-esm"), { recursive: true });
      await mkdir(join(frameworkCacheDir, "veryfront-http-bundle"), { recursive: true });
      await mkdir(join(frameworkCacheDir, "veryfront-modules"), { recursive: true });
      await mkdir(join(frameworkCacheDir, "veryfront-cycle-manifests"), { recursive: true });
      await mkdir(join(frameworkCacheDir, "other-tool"), { recursive: true });
      await writeTextFile(compiledModule, "compiled");
      await writeTextFile(mdxModule, "compiled");
      await writeTextFile(httpBundle, "compiled");
      await writeTextFile(transformedModule, "compiled");
      await writeTextFile(cycleManifest, "compiled");
      await writeTextFile(unrelatedCache, "keep");

      await cleanCommand({ projectDir: context.projectDir, cache: true, force: true });

      assertEquals(await exists(compiledModule), false);
      assertEquals(await exists(mdxModule), false);
      assertEquals(await exists(httpBundle), false);
      assertEquals(await exists(transformedModule), false);
      assertEquals(await exists(cycleManifest), false);
      assertEquals(await exists(unrelatedCache), true);
    });
  });

  it("removes the framework cache from an explicitly configured root", async () => {
    await withTestContext("cli-clean-configured-framework-cache", async (context) => {
      const configuredCacheDir = join(context.projectDir, "configured-cache");
      const defaultCacheDir = getProjectCacheDir(context.projectDir);
      context.setEnv({
        VF_CACHE_ALLOW_CLOSE: "1",
        VERYFRONT_CACHE_DIR: configuredCacheDir,
      });
      const compiledModule = join(configuredCacheDir, "veryfront-files", "configured.vfcache");
      const defaultCompiledModule = join(defaultCacheDir, "veryfront-files", "default.vfcache");
      const unrelatedDefaultCache = join(defaultCacheDir, "other-tool", "keep.txt");
      await mkdir(join(configuredCacheDir, "veryfront-files"), { recursive: true });
      await mkdir(join(defaultCacheDir, "veryfront-files"), { recursive: true });
      await mkdir(join(defaultCacheDir, "other-tool"), { recursive: true });
      await writeTextFile(compiledModule, "compiled");
      await writeTextFile(defaultCompiledModule, "compiled");
      await writeTextFile(unrelatedDefaultCache, "keep");

      await cleanCommand({ projectDir: context.projectDir, cache: true, force: true });

      assertEquals(await exists(compiledModule), false);
      assertEquals(await exists(defaultCompiledModule), false);
      assertEquals(await exists(unrelatedDefaultCache), true);
    });
  });
});
