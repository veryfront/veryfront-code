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
 * @module
 *
 * @example
 * ```ts
 * import { TailwindProcessor, processTailwindCSS } from './tailwind-processor/index.ts'
 *
 * // Process a single file
 * const result = await processTailwindCSS({
 *   projectDir: '/path/to/project',
 *   inputFile: '/path/to/project/styles/main.css',
 *   outputFile: '/path/to/project/.veryfront/css/main.css',
 * })
 *
 * // Or use the processor class directly
 * const processor = new TailwindProcessor(options)
 * const result = await processor.process()
 * ```
 */

// Type exports
export type {
  LightningCSSOptions,
  TailwindProcessorOptions,
  TailwindProcessResult,
} from "./types.ts";

// Core processor
export { TailwindProcessor } from "./processor.ts";

// Batch processing
export { processTailwindCSS, processTailwindCSSInDirectory } from "./batch-processor.ts";

// Detection utilities
export { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";

// CSS utilities
export { countUtilities, minifyCSS } from "./css-utils.ts";

// Lightning CSS integration
export { processWithLightningCSS } from "./lightning-processor.ts";
