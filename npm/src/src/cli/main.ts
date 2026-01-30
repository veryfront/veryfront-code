/**
 * Veryfront CLI
 *
 * Full-stack app renderer with SSR support
 */

// CRITICAL: Extract esbuild binary and set env var BEFORE any imports
// This must happen synchronously at the very start to ensure esbuild sees the correct path
import "../../_dnt.polyfills.js";

await import("../platform/compat/esbuild-init.js");

if (import.meta.main) {
  const { main } = await import("./index.js");
  await main();
}
