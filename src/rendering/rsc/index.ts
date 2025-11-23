/**
 * Veryfront RSC - Minimal React Server Components implementation
 */

export { hydrateRSC, RSCHydrator } from "./client-hydrator.ts";
export { analyzeComponent, buildClientManifest } from "./component-analyzer.ts";
export { RSCProductionOptimizer } from "./production-optimizer.ts";
export { RSCRenderer } from "./server-renderer/index.ts";

export type {
  ClientComponentMeta,
  ComponentAnalysis,
  ComponentType,
  RSCHydratorOptions,
  RSCNode,
  RSCPayload,
  RSCRendererOptions,
} from "./types.ts";
