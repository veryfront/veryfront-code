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
await import("veryfront/discovery/runtime-modules-bootstrap");

// All imports below must be dynamic to ensure esbuild init completes first
const { exit, getArgs, getEnv } = await import("veryfront/platform");
const args = getArgs();
const {
  isCliStartupDebugEnabled,
  reportCliEnvironmentStartupFailure,
} = await import(
  "./startup-error.ts"
);
const startupDebugEnabled = isCliStartupDebugEnabled(
  getEnv("VERYFRONT_DEBUG"),
);
try {
  const { hasEnvLoaded, loadEnv, markEnvLoaded, supportsEnvFiles } = await import(
    "veryfront/utils/env-loader"
  );
  const { initializeCliEnvironment } = await import("./startup-env.ts");
  await initializeCliEnvironment({
    hasEnvLoaded,
    supportsEnvFiles,
    loadEnv,
    markEnvLoaded,
    initializeEnvironmentConfig: async () => {
      const { initEnvironmentConfig } = await import("veryfront/config");
      initEnvironmentConfig();
    },
  });
} catch {
  reportCliEnvironmentStartupFailure(args, { debug: startupDebugEnabled });
  exit(1);
}
const { parseCliArgs } = await import("./shared/args.ts");
const { routeCommand } = await import("./router.ts");
await routeCommand(parseCliArgs(args));

// Exit cleanly after one-shot commands. Long-running commands (dev, start, mcp)
// never return from routeCommand, so this only runs for commands like deploy, push, init, build.
const { exitProcess } = await import("./utils/index.ts");
exitProcess(0);
