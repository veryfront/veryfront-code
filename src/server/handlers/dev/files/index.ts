/**
 * Development File Handler - Barrel Exports
 *
 * On-the-fly TypeScript/JSX bundling for development mode.
 *
 * @module server/handlers/dev/files
 */

// Export main handler
export { DevFileHandler } from "./dev-file-handler.ts";

// Export utilities (for testing/advanced usage)
export { validateDevFilePath } from "./path-validator.ts";
export { bundleDevFile } from "./esbuild-bundler.ts";
export { createBareExternalPlugin, createRelativeFsPlugin } from "./esbuild-plugins.ts";
