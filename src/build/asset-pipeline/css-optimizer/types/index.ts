/**
 * Css Optimizer - Types
 *
 * @module build/asset-pipeline/css-optimizer/types
 */

export interface LightningCSSTransformOptions {
  filename: string;
  code: Uint8Array;
  minify?: boolean;
  sourceMap?: boolean;
  targets?: BrowserTargets;
  analyzeDependencies?: boolean;
}

export interface LightningCSSTransformResult {
  code: Uint8Array;
  map?: Uint8Array | void;
}

export interface LightningCSSModule {
  transform: (options: LightningCSSTransformOptions) => LightningCSSTransformResult;
  default?: unknown;
}

export interface BrowserTargets {
  [browser: string]: number | undefined;
  chrome?: number;
  firefox?: number;
  safari?: number;
  edge?: number;
}

export interface CSSOptimizationOptions {
  enabled?: boolean;
  /** Absolute project boundary for CSS inputs, content scans, and outputs. */
  projectDir?: string;
  minify?: boolean;
  autoprefixer?: boolean;
  purge?: boolean;
  /**
   * @deprecated Batch optimization has no HTML document from which to derive
   * critical rules. Use `CSSOptimizer.extractCriticalCSS()` explicitly.
   */
  criticalCSS?: boolean;
  inputFiles?: string[];
  inputDir?: string;
  outputDir?: string;
  browsers?: string[];
  purgeContent?: string[];
  /** Literal selectors or tokens that PurgeCSS must retain. */
  purgeSafelist?: string[];
  sourceMap?: boolean;
}

export interface CSSBundle {
  file: string;
  /** Project-relative generated CSS path when known. */
  outputFile?: string;
  content: string;
  sourceMap?: string;
  size: number;
  minifiedSize: number;
  savings: number;
}

export interface CriticalCSSResult {
  critical: string;
  remaining: string;
  criticalSize: number;
  remainingSize: number;
}

export interface CSSProcessingResult {
  code: string;
  sourceMap?: string;
}

export interface CSSOptimizationStrategy {
  readonly name: string;
  readonly priority: number;
  canProcess(options: CSSOptimizationOptions): boolean;
  process(
    content: string,
    filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult>;
}

export interface SelectorExtractionResult {
  selectors: Set<string>;
  classes: string[];
  ids: string[];
  tags: string[];
}

export interface CSSOptimizerStats {
  totalFiles: number;
  originalSize: number;
  minifiedSize: number;
  totalSavings: number;
  averageSavings: number;
}
