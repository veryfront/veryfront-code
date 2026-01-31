/**
 * Veryfront CLI
 *
 * Full-stack app renderer with SSR support
 */

// CRITICAL: Extract esbuild binary and set env var BEFORE any imports
// This must happen synchronously at the very start to ensure esbuild sees the correct path
await import("#veryfront/platform/compat/esbuild-init.ts");

if (!import.meta.main) {
  // Trigger release test 20260130122243
} else {
  const { main } = await import("./index.ts");
  await main();
}
