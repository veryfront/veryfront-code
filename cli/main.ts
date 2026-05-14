/**
 * Veryfront CLI entry point.
 *
 * @module cli
 *
 * @example
 * ```sh
 * npx veryfront dev
 * ```
 */

// CRITICAL: Extract esbuild binary and set env var BEFORE any imports
// This must happen synchronously at the very start to ensure esbuild sees the correct path
await import("veryfront/platform/esbuild-init");

// Register default contracts shipped with the binary so CLI startup and
// bootstrap paths can resolve them before project extensions load.
{
  const { register } = await import("veryfront/extensions/contracts");
  const { tryResolve } = await import("veryfront/extensions");
  if (!tryResolve("SchemaValidator")) {
    const { createZodAdapter } = await import("@veryfront/ext-schema-zod");
    register("SchemaValidator", createZodAdapter());
  }
  if (!tryResolve("Bundler") || !tryResolve("ModuleLexer")) {
    const { EsbuildBundler, EsModuleLexer } = await import("@veryfront/ext-bundler-esbuild");
    if (!tryResolve("Bundler")) register("Bundler", new EsbuildBundler());
    if (!tryResolve("ModuleLexer")) register("ModuleLexer", new EsModuleLexer());
  }
}

// All imports below must be dynamic to ensure esbuild init completes first
const { getArgs } = await import("veryfront/platform");
const { hasEnvLoaded, loadEnv, markEnvLoaded, supportsEnvFiles } = await import(
  "veryfront/utils/env-loader"
);

/** Load `.env` files and initialize environment config if not already done. */
async function ensureEnvLoaded(): Promise<void> {
  if (hasEnvLoaded()) return;

  if (supportsEnvFiles()) {
    try {
      await loadEnv();
    } catch (e) {
      // Missing .env is fine; log other errors for debuggability
      if (e instanceof Deno.errors.NotFound === false) {
        console.error(`Warning: failed to load .env: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  markEnvLoaded();

  const { initEnvironmentConfig } = await import(
    "veryfront/config"
  );
  initEnvironmentConfig();
}

await ensureEnvLoaded();
const args = getArgs();
const { parseCliArgs } = await import("./shared/args.ts");
const { routeCommand } = await import("./router.ts");
await routeCommand(parseCliArgs(args));

// Exit cleanly after one-shot commands. Long-running commands (dev, start, mcp)
// never return from routeCommand, so this only runs for commands like deploy, push, init, build.
const { exitProcess } = await import("./utils/index.ts");
exitProcess(0);
