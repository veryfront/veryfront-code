/**
 * Render Orchestrator - Unified exports for the render orchestration layer
 *
 * This module provides a flat, Hono-inspired architecture for render orchestration.
 * All orchestration logic lives at src/render/orchestrator/ (3 levels deep).
 *
 * Location: src/render/orchestrator/index.ts
 */

// Main SSR orchestrator (combined orchestrator + ssr-orchestrator)
export { SSROrchestrator, VeryfrontRenderer } from "./ssr.ts";
export type { SSROrchestratorConfig, SSRRenderingResult } from "./ssr.ts";

// Configuration management
export { ConfigurationManager } from "./config.ts";
export type { ConfigurationOptions } from "./config.ts";

// Lifecycle management
export { RendererLifecycle } from "./lifecycle.ts";
export type { LifecycleOptions, RendererServices } from "./lifecycle.ts";

// Layout orchestration
export { LayoutOrchestrator } from "./layout.ts";
export type {
  LayoutCollectionResult,
  LayoutOrchestratorConfig,
  ProviderCollectionResult,
} from "./layout.ts";

// MDX compilation
export { MDXCompiler } from "./mdx.ts";
export type { MDXCompilerConfig } from "./mdx.ts";

// HTML generation
export { HTMLGenerator } from "./html.ts";
export type { HTMLGenerationContext, HTMLGeneratorConfig } from "./html.ts";

// Render pipeline
export { RenderPipeline } from "./pipeline.ts";
export type { RenderPipelineConfig } from "./pipeline.ts";

// Shared types
export type { RenderContext, RendererOptions, RenderOptions, RenderResult } from "./types.ts";
