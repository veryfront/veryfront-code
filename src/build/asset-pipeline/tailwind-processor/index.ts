export type {
  LightningCSSOptions,
  TailwindProcessorOptions,
  TailwindProcessResult,
} from "./types.ts";

export { TailwindProcessor } from "./processor.ts";
export { processTailwindCSS, processTailwindCSSInDirectory } from "./batch-processor.ts";
export { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";
export { countUtilities, minifyCSS } from "./css-utils.ts";
export { processWithLightningCSS } from "./lightning-processor.ts";
