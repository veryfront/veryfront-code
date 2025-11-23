/**
 * Type definitions for CSS Optimizer
 */

/**
 * Lightning CSS library types
 * Since lightningcss is an optional dependency loaded dynamically,
 * we define minimal type interfaces for the functionality we use.
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
  chrome?: number;
  firefox?: number;
  safari?: number;
  edge?: number;
}

/**
 * CSS Optimization configuration
 */
export interface CSSOptimizationOptions {
  enabled?: boolean;
  minify?: boolean;
  autoprefixer?: boolean;
  purge?: boolean;
  criticalCSS?: boolean;
  inputFiles?: string[];
  inputDir?: string;
  outputDir?: string;
  browsers?: string[];
  purgeContent?: string[];
  sourceMap?: boolean;
}

/**
 * CSS Bundle result
 */
export interface CSSBundle {
  file: string;
  content: string;
  sourceMap?: string;
  size: number;
  minifiedSize: number;
  savings: number;
}

/**
 * Critical CSS extraction result
 */
export interface CriticalCSSResult {
  critical: string;
  remaining: string;
  criticalSize: number;
  remainingSize: number;
}

/**
 * CSS processing result
 */
export interface CSSProcessingResult {
  code: string;
  sourceMap?: string;
}

/**
 * CSS Optimization Strategy interface
 */
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

/**
 * CSS Selector extraction result
 */
export interface SelectorExtractionResult {
  selectors: Set<string>;
  classes: string[];
  ids: string[];
  tags: string[];
}

/**
 * CSS Optimizer statistics
 */
export interface CSSOptimizerStats {
  totalFiles: number;
  originalSize: number;
  minifiedSize: number;
  totalSavings: number;
  averageSavings: number;
}
