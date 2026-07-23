import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { TransformOptions as PipelineTransformOptions } from "../pipeline/types.ts";

/** Options accepted by the ESM transform pipeline. */
export type TransformOptions = PipelineTransformOptions;

/** Legacy wrapper context retained for compatibility with loader consumers. */
export interface TransformContext {
  /** Source module text. */
  source: string;
  /** Source module path. */
  filePath: string;
  /** Project root directory. */
  projectDir: string;
  /** Runtime adapter used to read project files. */
  adapter: RuntimeAdapter;
  /** Pipeline options for this transform. */
  options: TransformOptions;
}
