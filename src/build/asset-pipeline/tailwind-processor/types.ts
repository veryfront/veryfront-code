import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export interface TailwindProcessorOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  inputFile: string;
  outputFile?: string;
  content?: string[];
  minify?: boolean;
  sourceMap?: boolean;
  browserslist?: string[];
}

export interface TailwindProcessResult {
  css: string;
  sourceMap?: string;
  processedFiles: string[];
  detectedUtilities: number;
}

export interface LightningCSSOptions {
  filename: string;
  minify?: boolean;
  sourceMap?: boolean;
  browserslist?: string[];
}
