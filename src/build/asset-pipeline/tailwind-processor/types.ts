import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";

export interface TailwindProcessorOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  inputFile: string;
  outputFile?: string;
  content?: string[];
  minify?: boolean;
  sourceMap?: boolean;
  optimizationEngine?: CSSOptimizationEngine;
}

export interface TailwindProcessResult {
  css: string;
  sourceMap?: string;
  processedFiles: string[];
  detectedUtilities: number;
}

export interface CSSOptimizationProcessOptions {
  sourcePath: string;
  minify?: boolean;
  sourceMap?: boolean;
}
