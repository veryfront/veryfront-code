/**
 * Layouts - Page Layout and Provider System
 *
 * Provides layout discovery, nesting, caching, and rendering support
 * for both app and pages router.
 *
 * This module consolidates:
 * - High-level layout system classes (Collector, Compiler, Applicator)
 * - Low-level layout utilities (discovery, compilation, application)
 * - Provider management
 */

// High-level layout system (class-based API)
export {
  type LayoutCollectionResult,
  LayoutCollector,
  type LayoutCollectorOptions,
} from "./layout-collector.ts";

export { LayoutCompiler, type LayoutCompilerOptions } from "./layout-compiler.ts";

export { type LayoutApplicationOptions, LayoutApplicator } from "./layout-applicator.ts";

export {
  type ProviderCollectionResult,
  ProviderManager,
  type ProviderManagerOptions,
} from "./provider-manager.ts";

// Low-level layout utilities
export type { LayoutDiscoveryOptions, NestedLayoutsResult } from "./types.ts";
export { discoverNestedLayouts } from "./utils/discovery.ts";
export { compileMDXLayouts } from "./utils/compiler.ts";
export { computeDepsHash } from "./utils/hash-calculator.ts";
export {
  applyMDXLayout,
  applyTSXLayout,
  loadMDXLayout,
  loadTSXComponent,
} from "./utils/component-loader.ts";
export { applyLayoutsESM, applyLayoutsFunctionBody } from "./utils/applicator.ts";
