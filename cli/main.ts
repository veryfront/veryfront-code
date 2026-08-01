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

// Set the CLI logger preset before importing modules that may log during initialization.
const { setLoggerPreset } = await import("veryfront/utils/logger");
setLoggerPreset("cli");

// Extract the esbuild binary before importing feature modules that may load esbuild.
await import("veryfront/platform/esbuild-init");

// All imports below must be dynamic to ensure esbuild init completes first
// Import only the process compatibility seam during bootstrap. The broad
// platform barrel initializes filesystem and cache consumers, which can emit
// debug output before malformed environment files have been contained.
const { exit, getArgs, getEnv } = await import(
  "veryfront/platform/process"
);
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
await import("veryfront/discovery/runtime-modules-bootstrap");
const { parseCliArgs } = await import("./shared/args.ts");
const { routeCommand } = await import("./router.ts");
await routeCommand(parseCliArgs(args));

// Exit cleanly after one-shot commands. Long-running commands (dev, start, mcp)
// never return from routeCommand, so this only runs for commands like deploy, push, init, build.
const { exitProcess } = await import("./utils/index.ts");
exitProcess(0);
