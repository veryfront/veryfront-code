#!/usr/bin/env -S deno run --allow-all --unstable-kv

/**
 * Veryfront CLI
 *
 * Full-stack app renderer with SSR support
 */

// Run CLI if this is the main module
if (import.meta.main) {
  const { main } = await import("./index.ts");
  await main();
}
