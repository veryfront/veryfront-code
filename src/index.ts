/**
 * Veryfront - Main Package
 *
 * This is the core API for building Veryfront applications.
 *
 * ## Subpath Exports (Advanced Use)
 * - `veryfront/server`     → Server APIs (startUniversalServer, createDevServer)
 * - `veryfront/middleware` → Middleware system
 * - `veryfront/components` → All React components (including OptimizedImage)
 * - `veryfront/data`       → Data fetching utilities
 * - `veryfront/config`     → Configuration utilities
 */

// ============================================================================
// React Components (Most Common)
// ============================================================================

export { Link } from "@veryfront/components";
export type { LinkProps } from "@veryfront/components";

export { Head } from "@veryfront/components";

export { MDXProvider, useMDXComponents } from "@veryfront/components";
export type { MDXProviderProps } from "@veryfront/components";

// Optimized Images
export {
  OptimizedBackgroundImage,
  OptimizedImage,
  SimpleOptimizedImage,
} from "@veryfront/components";
export type { OptimizedImageProps } from "@veryfront/components";

// ============================================================================
// Data Fetching
// ============================================================================

export type {
  DataContext,
  InferGetServerDataProps,
  PageWithData,
  StaticPathsResult,
} from "@veryfront/data";

// Data helpers (notFound/redirect for getServerData)
export { notFound, redirect } from "@veryfront/data";

// ============================================================================
// API Routes
// ============================================================================

export type { APIContext, APIHandler, APIResponse, APIRoute } from "@veryfront/routing";

// Response helpers
export {
  badRequest,
  forbidden,
  json,
  notFound as apiNotFound,
  redirect as apiRedirect,
  serverError,
  unauthorized,
} from "@veryfront/routing";

// Input validation (for API routes)
export {
  CommonSchemas,
  createValidatedHandler,
  parseFormData,
  parseJsonBody,
  parseQueryParams,
  sanitizeData,
  type ValidatedHandlerConfig,
  type ValidatedHandlerFunction,
  ValidationError,
} from "@veryfront/security";

// ============================================================================
// Configuration
// ============================================================================

export { defineConfig } from "@veryfront/config";
export type { VeryfrontConfig } from "@veryfront/config";

// ============================================================================
// Common Types
// ============================================================================

export type { ComponentProps, MDXFrontmatter, PageContext } from "@veryfront/types";

// ============================================================================
// AI Modules (Unified Entry Point)
// For advanced use, import from specific modules:
// - `veryfront/agent`   → Agent runtime, factory, memory
// - `veryfront/tool`    → Tool definition, registry, execution
// - `veryfront/workflow`→ Durable workflow engine
// - `veryfront/prompt`  → Prompt templates
// - `veryfront/resource`→ Resource definitions
// - `veryfront/mcp`     → Model Context Protocol server
// ============================================================================

// Agent
export { agent } from "@veryfront/agent";
export type { Agent, AgentConfig } from "@veryfront/agent";

// Tool
export { executeTool, tool } from "@veryfront/tool";
export type { Tool, ToolConfig } from "@veryfront/tool";

// Workflow
export { branch, parallel, step, waitForApproval, workflow } from "@veryfront/workflow";
export type { WorkflowDefinition, WorkflowRun } from "@veryfront/workflow";

// Prompt
export { prompt } from "@veryfront/prompt";
export type { Prompt, PromptConfig } from "@veryfront/prompt";

// Resource
export { resource } from "@veryfront/resource";
export type { Resource, ResourceConfig } from "@veryfront/resource";
