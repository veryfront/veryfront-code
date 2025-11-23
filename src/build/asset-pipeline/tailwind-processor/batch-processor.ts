/**
 * Batch processing utilities for Tailwind CSS
 *
 * Provides functions for processing multiple Tailwind files in directories.
 *
 * @module
 */

import { join } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { TailwindProcessor } from "./processor.ts";
import { isTailwindV4File } from "./detector.ts";

/**
 * Process a single Tailwind CSS file
 *
 * Convenience function for processing a single file without manually
 * creating a processor instance.
 *
 * @param options - Processor configuration options
 * @returns Processing result with CSS output and metadata
 *
 * @example
 * ```ts
 * const result = await processTailwindCSS({
 *   projectDir: '/path/to/project',
 *   inputFile: '/path/to/project/styles/main.css',
 *   outputFile: '/path/to/project/.veryfront/css/main.css',
 * })
 * ```
 */
export async function processTailwindCSS(
  options: TailwindProcessorOptions,
): Promise<TailwindProcessResult> {
  const processor = new TailwindProcessor(options);
  return await processor.process();
}

/**
 * Auto-detect and process all Tailwind CSS files in a directory
 *
 * Scans a directory for CSS files, identifies Tailwind v4 files,
 * and processes them in batch. Useful for build scripts that need
 * to process all CSS files in a project.
 *
 * @param projectDir - Project root directory
 * @param cssDir - Directory to scan for CSS files (relative to projectDir)
 * @param outputDir - Output directory for processed files (relative to projectDir)
 * @returns Array of processing results for all files
 *
 * @example
 * ```ts
 * const results = await processTailwindCSSInDirectory(
 *   '/path/to/project',
 *   'styles',
 *   '.veryfront/css'
 * )
 * console.log(`Processed ${results.length} files`)
 * ```
 */
export async function processTailwindCSSInDirectory(
  projectDir: string,
  cssDir: string = "styles",
  outputDir: string = ".veryfront/css",
): Promise<TailwindProcessResult[]> {
  const results: TailwindProcessResult[] = [];
  const cssPath = join(projectDir, cssDir);

  try {
    for await (const entry of Deno.readDir(cssPath)) {
      if (entry.isFile && (entry.name.endsWith(".css"))) {
        const filePath = join(cssPath, entry.name);

        if (await isTailwindV4File(filePath, projectDir, denoAdapter)) {
          logger.info("Found Tailwind v4 file", { file: filePath });

          const result = await processTailwindCSS({
            projectDir,
            adapter: denoAdapter,
            inputFile: filePath,
            outputFile: join(projectDir, outputDir, entry.name),
          });

          results.push(result);
        }
      }
    }
  } catch (error) {
    logger.error("Error processing Tailwind CSS directory", error);
  }

  return results;
}
