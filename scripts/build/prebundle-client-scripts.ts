#!/usr/bin/env -S deno run --allow-all
/**
 * Pre-bundle Client Scripts for Compiled Binary
 *
 * In `deno compile` builds, framework source files (src/rendering/client/*)
 * aren't embedded in the binary. This script bundles the client-side router
 * and prefetch scripts ahead of time and writes them to dist/framework-src/
 * so the compiled binary can load them without needing the original sources.
 *
 * Runs as part of `deno task build`, after prepare-framework-sources.ts
 * creates the dist/framework-src/ directory.
 */

import { dirname, fromFileUrl, join } from "#std/path.ts";
import {
  generateClientModule,
  generatePrefetchScript,
} from "../../src/build/production-build/client-runtime.ts";

const scriptDir = dirname(fromFileUrl(import.meta.url));
const projectRoot = join(scriptDir, "..", "..");
const outputPath = join(projectRoot, "dist", "framework-src", "_client-bundles.json");

console.log("[prebundle-client-scripts] Bundling client router...");
const routerBundle = await generateClientModule();

console.log("[prebundle-client-scripts] Bundling client prefetch...");
// deno-lint-ignore no-explicit-any
const prefetchBundle = await generatePrefetchScript(null as any);

const bundles = { routerBundle, prefetchBundle };
await Deno.writeTextFile(outputPath, JSON.stringify(bundles));

console.log(`[prebundle-client-scripts] Written to ${outputPath}`);
