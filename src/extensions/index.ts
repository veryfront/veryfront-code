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
export type { ExtensionActivationMode, PackageMetadata } from "./discovery.ts";
export {
  discoverLocalExtensions,
  discoverPackageExtensions,
  discoverProjectExtensions,
  mergeExtensions,
  parsePackageMetadata,
} from "./discovery.ts";

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
export { auditCapabilities, formatCapabilities, mapToDenoPermissions } from "./capabilities.ts";

// Recommendations
export { getRecommendation } from "./recommendations.ts";

// Provider-neutral distributed infrastructure
export {
  captureDistributedRuntimeProvider,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "./distributed/index.ts";

// Errors
export {
  CIRCULAR_DEPENDENCY_ERROR,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_VALIDATION_ERROR,
  MISSING_EXTENSION_ERROR,
} from "./errors.ts";

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

// Isolated worker rendering
export {
  createIsolatedSsrRendererProvider,
  type IsolatedSsrRenderer,
  type IsolatedSsrRendererModule,
  type IsolatedSsrRendererProvider,
  IsolatedSsrRendererProviderName,
  MAX_ISOLATED_SSR_RENDERER_READ_ROOTS,
  MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS,
  snapshotIsolatedSsrRendererProvider,
  validateIsolatedSsrRendererModuleUrl,
} from "./rendering/index.ts";

// Image optimization
export type {
  ImageOptimizationEngine,
  ImageOptimizationFormat,
  ImageOptimizationRequest,
  ImageOptimizationResult,
  ImageOptimizationVariantRequest,
  ImageOptimizationVariantResult,
} from "./image/index.ts";
export {
  assertImageOptimizationEngine,
  captureImageOptimizationEngine,
  ImageOptimizationEngineName,
  MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "./image/index.ts";

// Studio browser capabilities
export {
  createStudioCaptureBundleProvider,
  MAX_STUDIO_CAPTURE_BUNDLE_BYTES,
  snapshotStudioCaptureBundleProvider,
  type StudioCaptureBundleProvider,
  StudioCaptureBundleProviderName,
  validateStudioCaptureBundle,
} from "./studio/index.ts";

// Local development UI assets
export {
  createDevUiAssetProvider,
  DASHBOARD_CSRF_COOKIE_NAME,
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_CSRF_META_NAME,
  DASHBOARD_CSRF_TOKEN_PATTERN,
  DEV_UI_KIND_ATTRIBUTE,
  type DevUiAssetProvider,
  DevUiAssetProviderName,
  type DevUiKind,
  MAX_DEV_UI_BUNDLE_BYTES,
  snapshotDevUiAssetProvider,
  validateDevUiBundle,
} from "./dev-ui/index.ts";

// Node.js WebSocket transport implementation boundary
export {
  captureNodeWebSocketServer,
  createNodeWebSocketServerProvider,
  NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
  NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE,
  type NodeWebSocketConnection,
  type NodeWebSocketMessageData,
  type NodeWebSocketServer,
  type NodeWebSocketServerOptions,
  type NodeWebSocketServerProvider,
  NodeWebSocketServerProviderName,
  snapshotNodeWebSocketServerProvider,
} from "./websocket/index.ts";

// Skill script execution implementation boundary
export {
  type SkillScriptExecutionHandle,
  type SkillScriptExecutionReporter,
  type SkillScriptExecutorProvider,
  type SkillScriptExecutorProviderInput,
  SkillScriptExecutorProviderName,
  type SkillScriptExecutorProviderSnapshot,
  type SkillScriptPreparedExecution,
  snapshotSkillScriptExecutorProvider,
  snapshotSkillScriptPreparedExecution,
} from "./skill/index.ts";
