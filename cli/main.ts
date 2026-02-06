// CRITICAL: Extract esbuild binary and set env var BEFORE any imports
// This must happen synchronously at the very start to ensure esbuild sees the correct path
await import("#veryfront/platform/compat/esbuild-init.ts");

// All imports below must be dynamic to ensure esbuild init completes first
const { getArgs } = await import("#veryfront/platform/compat/process.ts");
const { hasEnvLoaded, loadEnv, markEnvLoaded, supportsEnvFiles } = await import(
  "#veryfront/utils/env-loader.ts"
);

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

  const { initEnvironmentConfig } = await import("#veryfront/config/environment-config.ts");
  initEnvironmentConfig();
}

await ensureEnvLoaded();
const args = getArgs();
const { parseCliArgs } = await import("./shared/arg-parser.ts");
const { routeCommand } = await import("./router.ts");
await routeCommand(parseCliArgs(args));
