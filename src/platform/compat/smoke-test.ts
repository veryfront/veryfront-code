#!/usr/bin/env -S deno run --allow-all
/**
 * Platform Compatibility Smoke Test
 *
 * This test dynamically imports all modules that were refactored to use
 * the platform compat layer. If any module fails to load, it indicates
 * a runtime compatibility issue.
 *
 * Run with:
 *   deno run --allow-all src/platform/compat/smoke-test.ts
 *   npx tsx src/platform/compat/smoke-test.ts
 *   bun run src/platform/compat/smoke-test.ts
 */

import { getRuntimeVersion } from "./process.ts";
import { isBun, isDeno, isNode } from "./runtime.ts";

interface ModuleResult {
  path: string;
  success: boolean;
  error?: string;
  exports?: string[];
}

const results: ModuleResult[] = [];

// Modules that were refactored to use platform compat
const MODULES_TO_TEST = [
  // Platform compat layer itself
  "@veryfront/platform/compat/path/index.ts",
  "@veryfront/platform/compat/process.ts",
  "@veryfront/platform/compat/fs.ts",
  "@veryfront/platform/compat/runtime.ts",

  // Core modules
  "@veryfront/config/loader.ts",
  "@veryfront/utils/file-discovery.ts",
  "@veryfront/utils/cache-dir.ts",
  "@veryfront/utils/import-lockfile.ts",
  "@veryfront/utils/memory/profiler.ts",
  "@veryfront/utils/lru-wrapper.ts",
  "@veryfront/utils/env-loader.ts",

  // Module system
  "@veryfront/modules/component-registry/registry.ts",
  "@veryfront/modules/import-map/loader.ts",
  "@veryfront/modules/module-resolver.ts",
  "@veryfront/modules/react-loader/temp-directory.ts",
  "@veryfront/modules/react-loader/unified-loader.ts",
  "@veryfront/modules/react-loader/component-loader.ts",
  "@veryfront/modules/react-loader/ssr-module-loader.ts",
  "@veryfront/modules/server/module-server.ts",

  // Server modules
  "@veryfront/server/dev-server/middleware.ts",
  "@veryfront/server/dev-server/route-discovery.ts",
  "@veryfront/server/dev-server/file-watch-setup.ts",
  "@veryfront/server/dev-server/bundler.ts",
  "@veryfront/server/build-app-route-renderer.ts",
  "@veryfront/server/build-routes.ts",

  // Rendering modules
  "@veryfront/rendering/chunk-optimizer.ts",
  "@veryfront/rendering/script-page-handling.ts",
  "@veryfront/rendering/rsc/component-analyzer.ts",
  "@veryfront/rendering/rsc/ids.ts",

  // Routing modules
  "@veryfront/routing/api/route-executor.ts",
  "@veryfront/routing/api/route-discovery.ts",
  "@veryfront/routing/api/handler.ts",

  // Build modules
  "@veryfront/build/utils/file-types.ts",
  "@veryfront/build/utils/asset-utils.ts",
  "@veryfront/build/compiler/mdx-compiler/directory-compiler.ts",
  "@veryfront/build/compiler/mdx-compiler/watcher.ts",
  "@veryfront/build/compiler/mdx-compiler/file-writer.ts",
  "@veryfront/build/compiler/mdx-to-js.ts",
  "@veryfront/build/embedded/preset.ts",
  "@veryfront/build/bundler/code-splitter/build-context.ts",
  "@veryfront/build/bundler/code-splitter/splitter.ts",
  "@veryfront/build/bundler/code-splitter/manifest-builder.ts",
  "@veryfront/build/bundler/code-splitter/esbuild-plugin.ts",
  "@veryfront/build/asset-pipeline/css-optimizer/optimizer-service.ts",
  "@veryfront/build/asset-pipeline/css-optimizer/utils.ts",
  "@veryfront/build/asset-pipeline/css-optimizer/css-bundle-cache.ts",
  "@veryfront/build/asset-pipeline/image-optimizer/variant-generator.ts",
  "@veryfront/build/asset-pipeline/image-optimizer/optimizer-core.ts",
  "@veryfront/build/asset-pipeline/image-optimizer/manifest-manager.ts",
  "@veryfront/build/asset-pipeline/image-optimizer/image-finder.ts",
  "@veryfront/build/asset-pipeline/tailwind-processor/batch-processor.ts",
  "@veryfront/build/asset-pipeline/tailwind-processor/processor.ts",
  "@veryfront/build/asset-pipeline/tailwind-processor/detector.ts",
  "@veryfront/build/production-build/asset-generation.ts",
  "@veryfront/build/production-build/client-runtime.ts",
  "@veryfront/build/production-build/static-generation.ts",

  // React compat
  "@veryfront/react/compat/config-generator.ts",
];

function getCurrentRuntime(): string {
  if (isDeno) return "Deno";
  if (isBun) return "Bun";
  if (isNode) return "Node.js";
  return "Unknown";
}

async function testModule(modulePath: string): Promise<ModuleResult> {
  try {
    const module = await import(modulePath);
    const exports = Object.keys(module);
    return {
      path: modulePath,
      success: true,
      exports,
    };
  } catch (error) {
    return {
      path: modulePath,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runSmokeTests(): Promise<void> {
  console.log(`\n\x1b[1m=== Platform Compatibility Smoke Test ===\x1b[0m`);
  console.log(`Runtime: \x1b[36m${getCurrentRuntime()}\x1b[0m`);
  console.log(`Version: \x1b[36m${getRuntimeVersion()}\x1b[0m`);
  console.log(`Testing ${MODULES_TO_TEST.length} modules...\n`);

  let passed = 0;
  let failed = 0;

  for (const modulePath of MODULES_TO_TEST) {
    const result = await testModule(modulePath);
    results.push(result);

    if (result.success) {
      passed++;
      console.log(`\x1b[32m✓\x1b[0m ${modulePath}`);
      if (result.exports && result.exports.length > 0) {
        console.log(
          `  \x1b[90mExports: ${result.exports.slice(0, 5).join(", ")}${
            result.exports.length > 5 ? "..." : ""
          }\x1b[0m`,
        );
      }
    } else {
      failed++;
      console.log(`\x1b[31m✗\x1b[0m ${modulePath}`);
      console.log(`  \x1b[31mError: ${result.error}\x1b[0m`);
    }
  }

  console.log(`\n\x1b[1m=== Summary ===\x1b[0m`);
  console.log(`Total:  ${MODULES_TO_TEST.length}`);
  console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);

  if (failed > 0) {
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
    console.log(`\n\x1b[31mFailed modules:\x1b[0m`);
    for (const result of results.filter((r) => !r.success)) {
      console.log(`  - ${result.path}`);
      console.log(`    ${result.error}`);
    }

    // Exit with error
    if (typeof Deno !== "undefined") {
      Deno.exit(1);
    } else if (typeof process !== "undefined") {
      process.exit(1);
    }
  } else {
    console.log(`\n\x1b[32mAll modules loaded successfully!\x1b[0m`);
    console.log(
      `\x1b[32mPlatform compat layer is working correctly on ${getCurrentRuntime()}.\x1b[0m\n`,
    );
  }
}

// Run tests
runSmokeTests().catch((error) => {
  console.error("Smoke test runner failed:", error);
  if (typeof Deno !== "undefined") {
    Deno.exit(1);
  } else if (typeof process !== "undefined") {
    process.exit(1);
  }
});
