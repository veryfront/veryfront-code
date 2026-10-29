import "../../_helpers/contract-init.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { stop as stopBundler } from "veryfront/extensions/bundler";
import {
  bundleProjectConfigSourceForImport,
  transpileConfigSourceForImport,
} from "#veryfront/config/loader.ts";

const CONTRACTS = ["Bundler", "ModuleLexer"] as const;

// CLI commands such as `task`, `eval` and `routes` load the project config
// without starting a server, so nothing has registered a Bundler yet.
describe("config loading with no registered Bundler", () => {
  const previous = new Map<string, unknown>();

  beforeEach(() => {
    for (const name of CONTRACTS) {
      previous.set(name, tryResolve(name));
      unregister(name);
    }
  });

  afterEach(async () => {
    if (tryResolve("Bundler")) await stopBundler();
    for (const name of CONTRACTS) {
      unregister(name);
      const implementation = previous.get(name);
      if (implementation) register(name, implementation);
    }
  });

  it("transpiles a TypeScript config with the built-in bundler", async () => {
    const source = 'const title: string = "repro";\nexport default { title };\n';

    const result = await transpileConfigSourceForImport(source, "/app/veryfront.config.ts");

    assert(!result.includes(": string"));
    assert(tryResolve("Bundler"));
  });

  it("bundles a TypeScript config with the built-in bundler", async () => {
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const source = 'const title: string = "repro";\nexport default { title };\n';
      await writeTextFile(configPath, source);

      const result = await bundleProjectConfigSourceForImport(source, configPath);
      const module = await import(
        `data:application/javascript;base64,${btoa(result)}`
      ) as { default: { title: string } };

      assertEquals(module.default.title, "repro");
    }, { prefix: "vf-config-bundler-registration-" });
  });
});
