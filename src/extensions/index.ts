/**
 * Extension authoring types and runtime helpers.
 *
 * @module extensions
 * @example
 * ```ts
 * import { orchestrateExtensions } from "veryfront/extensions";
 *
 * const loader = await orchestrateExtensions({
 *   projectDir: Deno.cwd(),
 *   config,
 *   logger,
 * });
 *
 * // Later, on shutdown:
 * await loader.teardownAll();
 * ```
 */

// Core types
export type {
  Capability,
  Extension,
  ExtensionConfigEntry,
  ExtensionContext,
  ExtensionContractMetadata,
  ExtensionFactory,
  ExtensionLogger,
  ExtensionSource,
  ResolvedExtension,
} from "./types.ts";

// Runtime compatibility
export { composeAbortSignals } from "./abort-signal.ts";

// Contract registry — resolve/tryResolve are the consumer-facing API.
// register()/reset() are internal primitives (used by ExtensionLoader and
// tests) and are intentionally not exported here.
export { resolve, tryResolve } from "./contracts.ts";

// Discovery
export type {
  DiscoveredPackageExtension,
  ExtensionActivationMode,
  PackageMetadata,
} from "./discovery.ts";
export {
  discoverLocalExtensions,
  discoverPackageExtensions,
  discoverProjectExtensions,
  mergeExtensions,
  parsePackageMetadata,
} from "./discovery.ts";
export { parseExtensionManifest } from "./manifest-reader.ts";

// Loader
export { ExtensionLoader } from "./loader.ts";

// Factory loader (dynamic-import of an extension factory)
export { loadExtensionFactory } from "./factory-loader.ts";

// Orchestrator (discover → load → merge → setup)
export type { OrchestrateOptions } from "./orchestrate.ts";
export { orchestrateExtensions } from "./orchestrate.ts";

// Validation
export type { ConflictInfo } from "./validation.ts";
export { detectConflicts, validateExtension } from "./validation.ts";

// Capabilities
export {
  assertSystemReadCapability,
  auditCapabilities,
  formatCapabilities,
  isSupportedDenoSystemReadApi,
  mapToDenoPermissions,
} from "./capabilities.ts";

// Recommendations
export { getRecommendation } from "./recommendations.ts";

// Provider-neutral Redis runtime
export {
  captureRedisRuntimeProvider,
  type RedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "./distributed/index.ts";

// Errors
export {
  CIRCULAR_DEPENDENCY_ERROR,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_VALIDATION_ERROR,
  MISSING_EXTENSION_ERROR,
} from "./errors.ts";

// Image optimization
export type {
  ImageOptimizationEngine,
  ImageOptimizationFormat,
  ImageOptimizationRequest,
  ImageOptimizationResult,
  ImageOptimizationVariantResult,
} from "./image/index.ts";
export {
  assertImageOptimizationEngine,
  captureImageOptimizationEngine,
  ImageOptimizationEngineName,
  MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "./image/index.ts";

// Sandbox
export type {
  CreateSandboxShellToolsInput,
  SandboxShellClient,
  SandboxShellToolDefinition,
  SandboxShellToolExecute,
  SandboxShellToolSet,
  SandboxShellToolsProvider,
} from "./sandbox/index.ts";
export { SandboxShellToolsProviderName } from "./sandbox/index.ts";
