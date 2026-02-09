#!/usr/bin/env -S deno run --allow-all
/**
 * Prepare Framework Sources for Binary Compilation
 *
 * This script copies framework source files (src/react/, src/lib/, etc.) to
 * dist/framework-src/ with a .src extension. This allows them to be embedded
 * in compiled binaries via `--include dist/framework-src` without Deno trying
 * to parse them as modules.
 *
 * At runtime, ssrVfModulesPlugin reads these .src files, transforms them JIT,
 * and caches the results - exactly like it does for source files in dev mode.
 *
 * Usage:
 *   deno run --allow-all scripts/prepare-framework-sources.ts
 *
 * This is run automatically before `deno compile` in production builds.
 */

import { walk } from "@std/fs";
import { dirname, join, relative } from "#std/path.ts";

const FRAMEWORK_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SRC_ROOT = join(FRAMEWORK_ROOT, "src");
const OUTPUT_DIR = join(FRAMEWORK_ROOT, "dist", "framework-src");
const METADATA_FILE = join(OUTPUT_DIR, ".compile-metadata.json");

// Directories containing framework code that may be imported by user projects
const FRAMEWORK_DIRS = [
  "react",
  "lib",
  "agent",
  "workflow",
];

// Extensions to process
const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

async function main() {
  console.log("[prepare-framework-sources] Starting...");
  console.log(`  Source: ${SRC_ROOT}`);
  console.log(`  Output: ${OUTPUT_DIR}`);

  // Clean output directory
  try {
    await Deno.remove(OUTPUT_DIR, { recursive: true });
  } catch {
    // Doesn't exist
  }

  let fileCount = 0;
  let totalBytes = 0;

  for (const dir of FRAMEWORK_DIRS) {
    const srcDir = join(SRC_ROOT, dir);

    try {
      await Deno.stat(srcDir);
    } catch {
      console.log(`  Skipping ${dir}/ (not found)`);
      continue;
    }

    for await (const entry of walk(srcDir, {
      exts: SOURCE_EXTENSIONS.map((e) => e.slice(1)), // Remove leading dot
      includeDirs: false,
    })) {
      // Skip test files
      if (entry.name.includes(".test.") || entry.name.includes(".spec.")) {
        continue;
      }

      const relativePath = relative(SRC_ROOT, entry.path);
      const outputPath = join(OUTPUT_DIR, relativePath + ".src");

      // Read source
      const content = await Deno.readTextFile(entry.path);

      // Create output directory
      await Deno.mkdir(dirname(outputPath), { recursive: true });

      // Write with .src extension
      await Deno.writeTextFile(outputPath, content);

      fileCount++;
      totalBytes += content.length;
    }
  }

  // Write metadata file for debugging
  const metadata = {
    frameworkRoot: FRAMEWORK_ROOT,
    embeddedSrcDir: OUTPUT_DIR,
    generatedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(METADATA_FILE, JSON.stringify(metadata, null, 2));

  console.log(`[prepare-framework-sources] Complete: ${fileCount} files, ${(totalBytes / 1024).toFixed(1)} KB`);
}

main();
