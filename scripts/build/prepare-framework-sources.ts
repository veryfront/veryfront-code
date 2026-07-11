#!/usr/bin/env -S deno run --allow-all
/**
 * Prepare Framework Sources for Binary Compilation
 *
 * This script copies runtime framework source files from src/ to
 * dist/framework-src/ with a .src extension. This allows them to be embedded
 * in compiled binaries via `--include dist/framework-src` without Deno trying
 * to parse them as modules.
 *
 * At runtime, ssrVfModulesPlugin reads these .src files, transforms them JIT,
 * and caches the results - exactly like it does for source files in dev mode.
 *
 * Usage:
 *   deno run --allow-all scripts/build/prepare-framework-sources.ts
 *
 * This is run automatically before `deno compile` in production builds.
 */

import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "#std/path.ts";

const FRAMEWORK_ROOT = fromFileUrl(new URL("../..", import.meta.url));
const SRC_ROOT = join(FRAMEWORK_ROOT, "src");
const OUTPUT_DIR = join(FRAMEWORK_ROOT, "dist", "framework-src");

// Extensions to process
const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export interface PrepareFrameworkSourcesOptions {
  srcRoot?: string;
  outputDir?: string;
}

export interface PrepareFrameworkSourcesResult {
  fileCount: number;
  totalBytes: number;
}

/** Embed every non-test runtime source so internal imports cannot outgrow a hand-maintained list. */
export async function prepareFrameworkSources(
  options: PrepareFrameworkSourcesOptions = {},
): Promise<PrepareFrameworkSourcesResult> {
  const srcRoot = options.srcRoot ?? SRC_ROOT;
  const outputDir = options.outputDir ?? OUTPUT_DIR;

  // Clean output directory
  try {
    await Deno.remove(outputDir, { recursive: true });
  } catch {
    /* expected: output may not exist */
  }

  let fileCount = 0;
  let totalBytes = 0;
  const encoder = new TextEncoder();

  for await (const entry of walk(srcRoot, {
    exts: SOURCE_EXTENSIONS.map((extension) => extension.slice(1)),
    includeDirs: false,
  })) {
    const relativePath = relative(srcRoot, entry.path);
    const normalizedPath = relativePath.replaceAll("\\", "/");
    if (
      normalizedPath.split("/").some((segment) =>
        segment === "__tests__" || segment === "__fixtures__"
      ) ||
      /\.(?:test|spec|test-helpers|bench)\./.test(entry.name)
    ) {
      continue;
    }

    const outputPath = join(outputDir, relativePath + ".src");

    const content = await Deno.readTextFile(entry.path);

    await Deno.mkdir(dirname(outputPath), { recursive: true });
    await Deno.writeTextFile(outputPath, content);

    fileCount++;
    totalBytes += encoder.encode(content).byteLength;
  }

  return { fileCount, totalBytes };
}

async function main(): Promise<void> {
  console.log("[prepare-framework-sources] Starting...");
  console.log(`  Source: ${SRC_ROOT}`);
  console.log(`  Output: ${OUTPUT_DIR}`);

  const { fileCount, totalBytes } = await prepareFrameworkSources();

  console.log(`[prepare-framework-sources] Complete: ${fileCount} files, ${(totalBytes / 1024).toFixed(1)} KB`);
}

if (import.meta.main) await main();
