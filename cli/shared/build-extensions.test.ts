import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EvalReportExporterRegistryName } from "veryfront/extensions/eval";
import { LLMProviderRegistryName } from "veryfront/extensions/llm";
import { setupBuildCliExtensions } from "./build-extensions.ts";

/** Minimal stand-in for the loader; the build path only needs it to resolve. */
const loaderStub = {} as Awaited<ReturnType<typeof setupBuildCliExtensions>>;

/**
 * Deferred builtins do not declare their contracts until they load, so identity
 * is what a caller can assert on before orchestration runs.
 */
function extensionNames(
  builtins: readonly { extension: { name: string } }[],
): Set<string> {
  return new Set(builtins.map((builtin) => builtin.extension.name));
}

describe("cli/shared/build-extensions", () => {
  it("composes the project's configured extensions", async () => {
    let seen: { projectDir?: string; config?: unknown } = {};
    // A full Extension entry: ExtensionConfigEntry only admits an Extension or
    // an explicit { name, enabled: false } disable.
    const config = {
      extensions: [{ name: "ext-css-lightning", version: "1.0.0", capabilities: [] }],
    };

    await setupBuildCliExtensions("/projects/app", config, (options) => {
      seen = { projectDir: options.projectDir, config: options.config };
      return Promise.resolve(loaderStub);
    });

    assertEquals(seen.projectDir, "/projects/app");
    // The build must honor what the project declares, not a hardcoded default.
    assertEquals(seen.config, config);
  });

  it("offers the CSSProcessor provider among the builtins", async () => {
    let builtins: readonly { extension: { name: string } }[] = [];

    await setupBuildCliExtensions("/projects/app", {}, (options) => {
      builtins = options.builtinExtensions ?? [];
      return Promise.resolve(loaderStub);
    });

    // Without this, `veryfront build` reaches the release-asset CSS compile with
    // no CSSProcessor registered and fails with "Missing extension for contract".
    assertEquals(extensionNames(builtins).has("ext-css-tailwind"), true);
  });

  it("offers the bundler and content providers the build also needs", async () => {
    let builtins: readonly { extension: { name: string } }[] = [];

    await setupBuildCliExtensions("/projects/app", {}, (options) => {
      builtins = options.builtinExtensions ?? [];
      return Promise.resolve(loaderStub);
    });

    const names = extensionNames(builtins);
    assertEquals(names.has("ext-bundler-esbuild"), true);
    assertEquals(names.has("ext-content-mdx"), true);
  });

  it("primes the contracts required by built-in providers and exporters", async () => {
    let primeContracts: Record<string, unknown> = {};

    await setupBuildCliExtensions("/projects/app", {}, (options) => {
      primeContracts = options.primeContracts ?? {};
      return Promise.resolve(loaderStub);
    });

    assertExists(primeContracts[LLMProviderRegistryName]);
    assertExists(primeContracts[EvalReportExporterRegistryName]);
  });

  it("hands orchestration a logger it can actually log through", async () => {
    // Not "names the build": cliLogger.component() deliberately returns the
    // same logger, because CLI output carries no structured component tag. So
    // there is no attribution to assert on, only that orchestration receives
    // something usable. `typeof x === "object"` alone would also accept null.
    let logger: Record<string, unknown> | undefined;

    await setupBuildCliExtensions("/projects/app", {}, (options) => {
      logger = options.logger as unknown as Record<string, unknown>;
      return Promise.resolve(loaderStub);
    });

    assertExists(logger);
    for (const method of ["debug", "info", "warn", "error"] as const) {
      assertEquals(typeof logger[method], "function", `logger.${method} must be callable`);
    }
  });

  it("returns the composed loader to the caller", async () => {
    const result = await setupBuildCliExtensions(
      "/projects/app",
      {},
      () => Promise.resolve(loaderStub),
    );

    assertEquals(result, loaderStub);
  });
});
