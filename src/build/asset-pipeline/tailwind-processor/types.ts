/**
 * Type definitions for Tailwind CSS v4 processor
 *
 * @module
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

/**
 * Configuration options for Tailwind CSS v4 processor
 */
export interface TailwindProcessorOptions {
  /**
   * Project root directory
   */
  projectDir: string;

  /**
   * Runtime adapter for filesystem access
   */
  adapter: RuntimeAdapter;

  /**
   * Input CSS file path
   */
  inputFile: string;

  /**
   * Output CSS file path
   */
  outputFile?: string;

  /**
   * Content paths for Tailwind to scan (auto-detected if not provided)
   */
  content?: string[];

  /**
   * Minify output
   */
  minify?: boolean;

  /**
   * Generate source maps
   */
  sourceMap?: boolean;

  /**
   * Browser targets (for autoprefixing)
   */
  browserslist?: string[];
}

/**
 * Result of Tailwind CSS processing
 */
export interface TailwindProcessResult {
  /**
   * Processed CSS output
   */
  css: string;

  /**
   * Source map (if generated)
   */
  sourceMap?: string;

  /**
   * List of files processed
   */
  processedFiles: string[];

  /**
   * Number of detected utilities
   */
  detectedUtilities: number;
}

/**
 * Options for Lightning CSS processing
 */
export interface LightningCSSOptions {
  /**
   * Input filename
   */
  filename: string;

  /**
   * Minify output
   */
  minify?: boolean;

  /**
   * Generate source maps
   */
  sourceMap?: boolean;

  /**
   * Browser targets
   */
  browserslist?: string[];
}
