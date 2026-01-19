/**
 * Tailwind CSS v4 Processor
 *
 * Main processor class for handling Tailwind CSS v4 with Lightning CSS integration.
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 *
 * @module
 */

import { dirname } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";
import { countUtilities } from "./css-utils.ts";
import { processWithLightningCSS } from "./lightning-processor.ts";
import { createSecureFs } from "#veryfront/security";

/**
 * Tailwind CSS v4 Processor with Lightning CSS
 *
 * Integrates Tailwind CSS v4's new @import-based system with Lightning CSS engine.
 * Based on: https://tailwindcss.com/blog/tailwindcss-v4-alpha
 *
 * Tailwind v4 changes:
 * - Uses @import "tailwindcss" instead of @tailwind directives
 * - Powered by Lightning CSS (Rust-based, extremely fast)
 * - Automatic content detection from imports
 * - No configuration file needed (zero-config)
 *
 * @example
 * ```ts
 * const processor = new TailwindProcessor({
 *   projectDir: '/path/to/project',
 *   inputFile: '/path/to/project/styles/main.css',
 *   outputFile: '/path/to/project/.veryfront/css/main.css',
 *   minify: true,
 * })
 *
 * const result = await processor.process()
 * console.log(`Processed ${result.detectedUtilities} utilities`)
 * ```
 */
export class TailwindProcessor {
  private options: TailwindProcessorOptions;

  /**
   * Creates a new Tailwind processor instance
   *
   * @param options - Processor configuration options
   */
  constructor(options: TailwindProcessorOptions) {
    this.options = {
      content: autoDetectContentPaths(options.projectDir),
      minify: true,
      sourceMap: false,
      browserslist: ["defaults", "not IE 11"],
      ...options,
    };
  }

  /**
   * Process Tailwind CSS file with Lightning CSS
   *
   * Main processing method that:
   * 1. Reads the input CSS file
   * 2. Validates it's a Tailwind v4 file
   * 3. Processes with Lightning CSS
   * 4. Counts utilities
   * 5. Writes output if specified
   *
   * @returns Processing result with CSS output and metadata
   *
   * @example
   * ```ts
   * const processor = new TailwindProcessor(options)
   * const result = await processor.process()
   * console.log(result.css)
   * ```
   */
  async process(): Promise<TailwindProcessResult> {
    const { inputFile, outputFile, content, minify, sourceMap, browserslist, projectDir, adapter } =
      this.options;

    // Create secure filesystem wrapper for build operations
    const secureFs = createSecureFs({
      baseDir: projectDir,
      adapter,
      context: "build",
      throwOnError: true, // Throw on errors for build failures
    });

    logger.info("Processing Tailwind CSS v4...", { inputFile, outputFile });

    // Read input CSS (using secure wrapper)
    const inputCSS = await secureFs.readFile(inputFile);

    // Check if this is a Tailwind v4 file
    const isTailwind = await isTailwindV4File(inputFile, projectDir, adapter);
    if (!isTailwind) {
      logger.warn('File does not appear to be Tailwind v4 (@import "tailwindcss" not found)', {
        inputFile,
      });
    }

    // For Tailwind v4, we need to:
    // 1. Resolve @import "tailwindcss" (would normally be handled by Tailwind's resolver)
    // 2. Process with Lightning CSS for transforms
    // 3. Apply content scanning for purging

    // Since Tailwind v4 uses Lightning CSS natively, we can use Lightning CSS directly
    // with custom import resolution for "tailwindcss"
    const processedCSS = await processWithLightningCSS(inputCSS, {
      filename: inputFile,
      minify,
      sourceMap,
      browserslist,
    });

    // Auto-detect utilities used (simple heuristic)
    const detectedUtilities = countUtilities(processedCSS);

    const result: TailwindProcessResult = {
      css: processedCSS,
      processedFiles: [inputFile, ...(content ?? [])],
      detectedUtilities,
    };

    // Write output if specified (using secure wrapper)
    if (outputFile) {
      const dirPath = dirname(outputFile);
      await secureFs.mkdir(dirPath, { recursive: true });
      await secureFs.writeFile(outputFile, processedCSS);
      logger.info("Tailwind CSS processed successfully", {
        inputFile,
        outputFile,
        size: processedCSS.length,
        utilities: detectedUtilities,
      });
    }

    return result;
  }
}
