/**
 * Rendering Rsc
 *
 * @module rendering/rsc
 */

export { analyzeComponent, buildClientManifest } from "./component-analyzer.ts";
export { extractExportNames } from "./export-extractor.ts";
export { RSCProductionOptimizer } from "./production-optimizer.ts";
export { RSCRenderer } from "./server-renderer/index.ts";

export type {
  ClientComponentMeta,
  ComponentAnalysis,
  ComponentType,
  RSCNode,
  RSCPayload,
  RSCRendererOptions,
} from "./types.ts";
