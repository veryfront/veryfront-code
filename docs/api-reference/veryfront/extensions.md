---
title: "veryfront/extensions"
description: "Extension authoring types and runtime helpers."
order: 10
---

## Import

```ts
import {
  assertImageOptimizationEngine,
  auditCapabilities,
  captureDistributedRuntimeProvider,
  captureImageOptimizationEngine,
  captureNodeWebSocketServer,
  createDevUiAssetProvider,
} from "veryfront/extensions";
```

## Examples

```ts
import { orchestrateExtensions } from "veryfront/extensions";

const loader = await orchestrateExtensions({
  projectDir: Deno.cwd(),
  config,
  logger,
});

// Later, on shutdown:
await loader.teardownAll();
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `DevUiAssetProviderName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L9) |
| `DistributedRuntimeProviderName` | Registry name used by distributed-infrastructure extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L25) |
| `ImageOptimizationEngineName` | Registry name used for the image optimization extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L14) |
| `IsolatedSsrRendererProviderName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L11) |
| `NodeWebSocketServerProviderName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L11) |
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L5) |
| `SkillScriptExecutorProviderName` | Contract name registered by one composed script-execution extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L48) |
| `StudioCaptureBundleProviderName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/studio/studio-capture-bundle-provider.ts#L15) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertImageOptimizationEngine` | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L120) |
| `auditCapabilities` | Log capabilities for a named extension at startup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L834) |
| `captureDistributedRuntimeProvider` | Capture a provider's complete callable surface without invoking accessors. Later mutation of the registry object cannot redirect active operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L433) |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L127) |
| `captureNodeWebSocketServer` | Capture one server instance without retaining mutable method lookups. The underlying implementation remains the receiver because protocol engines legitimately keep mutable transport state on their instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L142) |
| `createDevUiAssetProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L33) |
| `createIsolatedSsrRendererProvider` | Create immutable registration metadata for an extension factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L189) |
| `createNodeWebSocketServerProvider` | Create immutable registration metadata from a standalone factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L231) |
| `createStudioCaptureBundleProvider` | Create an immutable provider suitable for extension contract registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/studio/studio-capture-bundle-provider.ts#L50) |
| `detectConflicts` | Detect contract conflicts between resolved extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L509) |
| `discoverLocalExtensions` | Find `*.extension.ts` files in the project root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L436) |
| `discoverPackageExtensions` | Scan `node_modules` (including `@scoped` packages) for packages that declare veryfront extension metadata in their `package.json`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L348) |
| `discoverProjectExtensions` | Discover project extensions living under `extensions/` in the project root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L407) |
| `formatCapabilities` | Format capabilities as human-readable strings for logging. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L36) |
| `getRecommendation` | Return recommendation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/recommendations.ts#L38) |
| `loadExtensionFactory` | Dynamically import an extension factory from `path` and resolve it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/factory-loader.ts#L34) |
| `mapToDenoPermissions` | Map capabilities to Deno CLI permission flags. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L787) |
| `mergeExtensions` | Merge extensions from all four sources in priority order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L169) |
| `orchestrateExtensions` | Run the full extension pipeline against a resolved project config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L117) |
| `parsePackageMetadata` | Parse veryfront extension metadata from a package.json-like object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L132) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L18) |
| `snapshotDevUiAssetProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L27) |
| `snapshotIsolatedSsrRendererProvider` | Snapshot an extension-owned provider without invoking accessors or retaining mutable provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L84) |
| `snapshotNodeWebSocketServerProvider` | Capture a provider generation without retaining its mutable registration object or invoking extension-owned accessors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L189) |
| `snapshotSkillScriptExecutorProvider` | Capture a provider and validate inert controls before returning ownership. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L711) |
| `snapshotSkillScriptPreparedExecution` | Capture inert controls without retaining mutable method properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L433) |
| `snapshotStudioCaptureBundleProvider` | Snapshot an untrusted extension contract without invoking accessors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/studio/studio-capture-bundle-provider.ts#L40) |
| `tryResolve` | Try to resolve. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L37) |
| `validateDevUiBundle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L23) |
| `validateExtension` | Validate the shape of an extension object. Returns an array of issue descriptions (empty array = valid). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L353) |
| `validateIsolatedSsrRendererModuleUrl` | Validate one worker renderer module URL without resolving or importing it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L72) |
| `validateStudioCaptureBundle` | Validate the shared format and UTF-8 byte budget for every Studio bridge bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/studio/studio-capture-bundle-provider.ts#L30) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ExtensionLoader` | Implement extension loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts#L210) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Capability` | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L11) |
| `ConflictInfo` | Information about a contract conflict between extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L29) |
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L38) |
| `DevUiAssetProvider` | One self-contained browser bundle mounts dashboard or projects by shell identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L19) |
| `DevUiKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L29) |
| `DistributedRuntimeProvider` | Optional distributed runtime implementation supplied by an extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L295) |
| `Extension` | Public API contract for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L50) |
| `ExtensionActivationMode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L30) |
| `ExtensionConfigEntry` | Entry shape for extension config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L65) |
| `ExtensionContext` | Context for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L27) |
| `ExtensionContractMetadata` | Public API contract for extension contract metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L17) |
| `ExtensionFactory` | Public API contract for extension factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L62) |
| `ExtensionLogger` | Public API contract for extension logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L42) |
| `ExtensionSource` | Public API contract for extension source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L70) |
| `ImageOptimizationEngine` | Image decoder, resizer, and encoder implemented by an explicit extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L54) |
| `ImageOptimizationFormat` | Formats core can request from an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L21) |
| `ImageOptimizationRequest` | Immutable byte-oriented request supplied by core. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L31) |
| `ImageOptimizationResult` | Portable result returned by an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L47) |
| `ImageOptimizationVariantRequest` | One immutable output requested from an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L24) |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L39) |
| `IsolatedSsrRenderer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L22) |
| `IsolatedSsrRendererModule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L31) |
| `IsolatedSsrRendererProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L15) |
| `NodeWebSocketConnection` | Minimal connection surface consumed by core's runtime-neutral adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L24) |
| `NodeWebSocketMessageData` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L18) |
| `NodeWebSocketServer` | Minimal server surface used by upgrade and shutdown ownership. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L50) |
| `NodeWebSocketServerOptions` | Exact no-server options supplied by core for an existing HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L41) |
| `NodeWebSocketServerProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L66) |
| `OrchestrateOptions` | Options for `orchestrateExtensions`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L29) |
| `PackageMetadata` | Metadata extracted from a package.json that declares itself as a veryfront extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L19) |
| `ResolvedExtension` | Public API contract for resolved extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L78) |
| `SandboxShellClient` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L30) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L13) |
| `SandboxShellToolExecute` | Public API contract for sandbox shell tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L8) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L27) |
| `SandboxShellToolsProvider` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L47) |
| `SkillScriptExecutionHandle` | Core-owned execution lifecycle returned to application composition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L67) |
| `SkillScriptExecutionReporter` | Provider callbacks used to report one result and one terminal settlement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L51) |
| `SkillScriptExecutorProvider` | Extension-owned implementation selected by application composition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L78) |
| `SkillScriptExecutorProviderInput` | Canonical detached input delivered to a composed execution provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L75) |
| `SkillScriptExecutorProviderSnapshot` | Validated provider facade that owns settlement promises for its caller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L92) |
| `SkillScriptPreparedExecution` | Inert provider-owned controls returned before execution begins. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L59) |
| `StudioCaptureBundleProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/studio/studio-capture-bundle-provider.ts#L24) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `CIRCULAR_DEPENDENCY_ERROR` | Shared circular dependency error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L28) |
| `DASHBOARD_CSRF_COOKIE_NAME` | Stable prefix for port-scoped privileged dashboard session cookies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L2) |
| `DASHBOARD_CSRF_HEADER_NAME` | Shared request header carrying the shell's session-bound CSRF token. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L4) |
| `DASHBOARD_CSRF_META_NAME` | Shared metadata name used to pass the CSRF token into the extension UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L6) |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L25) |
| `DEV_UI_KIND_ATTRIBUTE` | Stable shell identity consumed by the extension-owned shared bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L28) |
| `EXTENSION_CONFLICT_ERROR` | Shared extension conflict error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L37) |
| `EXTENSION_VALIDATION_ERROR` | Shared extension validation error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L19) |
| `MAX_DEV_UI_BUNDLE_BYTES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L10) |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L17) |
| `MAX_ISOLATED_SSR_RENDERER_READ_ROOTS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L12) |
| `MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L13) |
| `MAX_STUDIO_CAPTURE_BUNDLE_BYTES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/studio/studio-capture-bundle-provider.ts#L16) |
| `MISSING_EXTENSION_ERROR` | Shared missing extension error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L10) |
| `NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L13) |
| `NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L12) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/extensions/auth`

Auth category barrel - AuthProvider contract and token shapes.

```ts
import "veryfront/extensions/auth";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthProvider` | AuthProvider contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L60) |
| `SignOptions` | Options for signing a token. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L22) |
| `TokenHeader` | The parsed, unverified header of a JWT. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L46) |
| `TokenPayload` | Payload data stored within a signed token. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L10) |
| `VerifyOptions` | Options for verifying a token. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L32) |

### `veryfront/extensions/bundler`

Bundler category barrel - Bundler contract, module lexer, and resolver helper.

```ts
import { build, context, getBundler } from "veryfront/extensions/bundler";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `build` | Convenience wrapper: `bundler.bundle(opts)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L27) |
| `context` | Create an incremental build context (watch/rebuild mode). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L52) |
| `getBundler` | Resolve the registered `Bundler` contract. Throws if no extension provides it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L22) |
| `stop` | Stop the bundler. Optional - extension teardown will also call this. Provided so tests that previously called `esbuild.stop()` keep working. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L46) |
| `transform` | Convenience wrapper that mirrors esbuild's `transform(code, options)` positional signature so call-sites migrating off esbuild keep their shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L35) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BuildContext` | Incremental/rebuild context produced by `Bundler.context`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L261) |
| `BuildFailure` | Failure thrown by `Bundler.bundle` or `Bundler.transform`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L269) |
| `BuildOptions` | Options passed to `Bundler.bundle`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L59) |
| `BuildResult` | Result returned from `Bundler.bundle`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L119) |
| `BundleOptions` | Options passed to `Bundler.bundle`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L59) |
| `BundleOutput` | A single output file produced by a bundle operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L107) |
| `Bundler` | Bundler contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L280) |
| `BundleResult` | Result returned from `Bundler.bundle`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L119) |
| `BundlerMessage` | A diagnostic message (error or warning) from a bundler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L19) |
| `BundlerMessageLocation` | Location of an error or warning in source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L10) |
| `BundlerPlugin` | A bundler plugin that hooks into the build pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L253) |
| `BundlerPluginBuild` | Build context exposed to bundler plugins. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L226) |
| `ImportSpecifier` | A single import specifier position record, matching the shape produced by `es-module-lexer`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L18) |
| `Loader` | Loader hint for source files. Mirrors esbuild's `Loader` type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L131) |
| `Message` | A diagnostic message (error or warning) from a bundler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L19) |
| `Metafile` | Dependency-graph metadata produced by a bundler when `metafile: true`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L45) |
| `MetafileInput` | Input file entry in a `Metafile`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L28) |
| `MetafileOutput` | Output file entry in a `Metafile`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L35) |
| `ModuleLexer` | Module lexer contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L41) |
| `OnLoadArgs` | Arguments passed to an `onLoad` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L207) |
| `OnLoadResult` | Result returned from an `onLoad` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L215) |
| `OnResolveArgs` | Arguments passed to an `onResolve` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L184) |
| `OnResolveResult` | Result returned from an `onResolve` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L195) |
| `Plugin` | A bundler plugin that hooks into the build pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L253) |
| `PluginBuild` | Build context exposed to bundler plugins. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L226) |
| `ResolveResult` | Result returned from an `onResolve` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L195) |
| `StdinOptions` | In-memory source input for `BundleOptions.stdin`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L51) |
| `TransformOptions` | Options passed to `Bundler.transform`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L148) |
| `TransformResult` | Result returned from `Bundler.transform`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L174) |

### `veryfront/extensions/cache`

Cache category barrel - generic cache and proxy-grade token cache.

```ts
import "veryfront/extensions/cache";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CacheStore` | CacheStore contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/cache-store.ts#L14) |
| `TokenCacheEntry` | A cache entry stored by `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L17) |
| `TokenCacheStats` | Aggregate usage statistics for a `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L28) |
| `TokenCacheStore` | TokenCacheStore contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L41) |

### `veryfront/extensions/compat`

Compat category barrel - optional native runtime services.

```ts
import "veryfront/extensions/compat";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DocumentExtractionOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L60) |
| `DocumentExtractionProgress` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L56) |
| `DocumentExtractionProgressEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L49) |
| `DocumentExtractor` | Document extraction contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L71) |
| `KreuzbergExtractor` | Shape returned by the kreuzberg document-extraction module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L41) |
| `SqliteDatabase` | Minimal interface for a SQLite database connection, compatible with `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L30) |
| `SqliteStatement` | Minimal interface for a prepared SQLite statement, compatible with `better-sqlite3`'s `Statement` shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L15) |
| `SqliteStore` | SQLite-backed storage contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L96) |

### `veryfront/extensions/content`

Content category barrel for the MDX/Markdown content processor contract.

```ts
import "veryfront/extensions/content";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CompilationMode` | Build mode made available to content-pipeline integrations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L23) |
| `CompilationTarget` | Where the output is destined: server-side RSC or browser bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L26) |
| `ContentCompileOptions` | Options for `ContentProcessor.compileMdx` and `ContentProcessor.compileMarkdown`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L81) |
| `ContentFrontmatterOptions` | Options for syntax-aware frontmatter extraction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L48) |
| `ContentFrontmatterResult` | Source body and merged metadata returned by frontmatter extraction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L58) |
| `ContentModuleValues` | Values injected into a generated MDX program after the source document has been parsed. Values must be finite JSON data stored in plain objects, dense arrays, and data properties; dates normalize to ISO strings. Accessors, symbols, cycles, sparse arrays, non-plain objects, and non-finite numbers are rejected. Keys must be valid JavaScript identifiers, and one key cannot be both a binding and an export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L73) |
| `ContentPlugin` | Opaque unified-compatible plugin or `[plugin, ...parameters]` tuple. The contract stays independent of `unified` types, and implementations preserve tuple boundaries and list order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L119) |
| `ContentProcessingResult` | Processing result returned by the content pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L29) |
| `ContentProcessor` | ContentProcessor contract for MDX/Markdown processing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L133) |
| `ContentSyntax` | Syntax family used when classifying document metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L45) |

### `veryfront/extensions/contracts`

Contract registry - runtime resolution of extension-provided implementations.

```ts
import { register, reset, resolve } from "veryfront/extensions/contracts";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `register` | Register. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L43) |
| `reset` | Reset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L58) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L18) |
| `tryResolve` | Try to resolve. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L37) |
| `unregister` | Unregister. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L52) |

### `veryfront/extensions/css`

CSS category barrel - CSS compilation and optimization contracts.

```ts
import { assertCSSOptimizationEngine, assertCSSPurgingEngine, captureCSSOptimizationEngine } from "veryfront/extensions/css";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `CSSOptimizationEngineName` | Registry name used for the CSS optimization extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L13) |
| `CSSProcessorName` | Registry name used for the CSS compiler extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L19) |
| `CSSPurgingEngineName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L12) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCSSOptimizationEngine` | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L105) |
| `assertCSSPurgingEngine` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L80) |
| `captureCSSOptimizationEngine` | Capture dynamic properties once so later mutation or accessors cannot change the implementation that core invokes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L115) |
| `captureCSSPurgingEngine` | Capture identity and method once so registry mutation cannot split a run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L85) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CSSCompiler` | Stateful compiler returned by `CSSProcessor.compile`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L24) |
| `CSSOptimizationEngine` | Parser-backed CSS optimization contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L38) |
| `CSSOptimizationRequest` | Immutable optimization request supplied by core. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L19) |
| `CSSOptimizationResult` | Portable output returned by a CSS optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L27) |
| `CSSProcessor` | CSSProcessor contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L40) |
| `CSSPurgeContentSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L15) |
| `CSSPurgingEngine` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L32) |
| `CSSPurgingRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L20) |
| `CSSPurgingResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L27) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the runtime boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L16) |
| `MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L21) |
| `MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L20) |
| `MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L13) |

### `veryfront/extensions/database`

Database category barrel - DatabaseClient contract.

```ts
import "veryfront/extensions/database";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DatabaseClient` | DatabaseClient contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L23) |
| `QueryResult` | Result returned from `DatabaseClient.query`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L10) |

### `veryfront/extensions/dev-ui`

Contracts and protocol constants for extension-owned local development UIs.

```ts
import { createDevUiAssetProvider, getDashboardSessionCookieName, snapshotDevUiAssetProvider } from "veryfront/extensions/dev-ui";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DevUiAssetProviderName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L9) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createDevUiAssetProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L33) |
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L17) |
| `snapshotDevUiAssetProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L27) |
| `validateDevUiBundle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L23) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DevUiAssetProvider` | One self-contained browser bundle mounts dashboard or projects by shell identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L19) |
| `DevUiKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L29) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `DASHBOARD_CSRF_COOKIE_NAME` | Stable prefix for port-scoped privileged dashboard session cookies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L2) |
| `DASHBOARD_CSRF_HEADER_NAME` | Shared request header carrying the shell's session-bound CSRF token. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L4) |
| `DASHBOARD_CSRF_META_NAME` | Shared metadata name used to pass the CSRF token into the extension UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L6) |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L25) |
| `DASHBOARD_SESSION_PATH` | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L8) |
| `DEV_UI_KIND_ATTRIBUTE` | Stable shell identity consumed by the extension-owned shared bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L28) |
| `MAX_DEV_UI_BUNDLE_BYTES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L10) |

### `veryfront/extensions/dev-ui/protocol`

Stable prefix for port-scoped privileged dashboard session cookies.

```ts
import { getDashboardSessionCookieName, DASHBOARD_CSRF_COOKIE_NAME, DASHBOARD_CSRF_HEADER_NAME } from "veryfront/extensions/dev-ui/protocol";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L17) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DevUiKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L29) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `DASHBOARD_CSRF_COOKIE_NAME` | Stable prefix for port-scoped privileged dashboard session cookies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L2) |
| `DASHBOARD_CSRF_HEADER_NAME` | Shared request header carrying the shell's session-bound CSRF token. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L4) |
| `DASHBOARD_CSRF_META_NAME` | Shared metadata name used to pass the CSRF token into the extension UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L6) |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L25) |
| `DASHBOARD_SESSION_PATH` | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L8) |
| `DEV_UI_KIND_ATTRIBUTE` | Stable shell identity consumed by the extension-owned shared bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L28) |

### `veryfront/extensions/distributed`

Provider-neutral contracts for optional distributed runtime infrastructure.

```ts
import { captureDistributedCacheAdministration, captureDistributedRuntimeProvider, captureDistributedWorkflowWorkerEnvironment } from "veryfront/extensions/distributed";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DistributedRuntimeProviderName` | Registry name used by distributed-infrastructure extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L25) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `captureDistributedCacheAdministration` | Capture the administrative surface returned by a distributed provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L189) |
| `captureDistributedRuntimeProvider` | Capture a provider's complete callable surface without invoking accessors. Later mutation of the registry object cannot redirect active operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L433) |
| `captureDistributedWorkflowWorkerEnvironment` | Snapshot and bound provider-owned environment passed to isolated workflow processes. Core reserves execution/tenant identity variables and never evaluates provider-specific names or values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L357) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DistributedAgentMemoryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L82) |
| `DistributedCacheAdministration` | Narrow administrative surface used by core cache diagnostics/invalidation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L127) |
| `DistributedCacheBackendOptions` | Feature-level cache options. Connection ownership belongs to the extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L56) |
| `DistributedCacheKeyListing` | Immutable bounded cache listing with explicit completeness. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L121) |
| `DistributedCacheListOptions` | Bounded provider-neutral cache listing request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L115) |
| `DistributedEventPublisherOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L90) |
| `DistributedRateLimitStoreOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L77) |
| `DistributedRenderCacheStoreOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L60) |
| `DistributedRoutingInvalidationBus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L110) |
| `DistributedRoutingInvalidationLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L95) |
| `DistributedRoutingInvalidationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L101) |
| `DistributedRuntimeProvider` | Optional distributed runtime implementation supplied by an extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L295) |
| `DistributedWorkflowBackendOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L65) |
| `DistributedWorkflowWorkerEnvironment` | Provider-owned environment required by an isolated workflow worker process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L75) |

### `veryfront/extensions/distributed/agent-memory-support`

Provider-neutral agent-memory contracts shared with memory extensions.

```ts
import { estimateTokens } from "veryfront/extensions/distributed/agent-memory-support";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `estimateTokens` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L66) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `Memory` | Public API contract for memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L41) |
| `MemoryConfigBase` | ************************ Memory Interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L12) |
| `MemoryStats` | Public API contract for memory stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L26) |
| `MinimalMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L32) |

### `veryfront/extensions/distributed/cache-support`

Provider-neutral cache helpers shared with distributed store extensions.

```ts
import { assertCacheBatchSize, buildBatchResults, escapeCacheGlobLiteral } from "veryfront/extensions/distributed/cache-support";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCacheBatchSize` | Enforce the cache subsystem's shared per-operation batch bound. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-policy.ts#L9) |
| `buildBatchResults` | Build a `Map` of batch results by resolving each key in order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-results.ts#L21) |
| `escapeCacheGlobLiteral` | Escape the wildcard syntax shared by cache backend pattern operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L304) |
| `expiresImmediately` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L45) |
| `parseSerializedCachePayload` | Reject oversized or malformed JSON before constructing an untrusted object graph. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts#L950) |
| `registerRenderDistributedCacheNamespace` | Register a namespace containing render-cache keys. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L276) |
| `requirePositiveIntegerCacheTtlSeconds` | Validate a constructor-level TTL for whole-second cache protocols. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L68) |
| `resolveIntegerCacheTtlSeconds` | Resolve a TTL for protocols that accept only whole seconds. Positive fractions round up so integer conversion never expires an entry earlier than requested; non-positive values retain their immediate-expiry meaning. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L37) |
| `serializeCachePayload` | Serialize using the origin-compatible payload shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts#L884) |
| `validateDistributedCacheKeyPrefix` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L166) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CacheBackend` | Provides storage operations for memory, disk, API, and extension-backed distributed caches. All cache backends must implement this interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L20) |
| `CachePayload` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L3) |
| `CacheStoreStats` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L12) |
| `RenderCacheStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L16) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_CACHE_TTL_SECONDS` | Shared default used when a CacheBackend caller omits a TTL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L81) |

### `veryfront/extensions/distributed/rate-limit-support`

Provider-neutral rate-limit helpers shared with store extensions.

```ts
import { requireRateLimitKey, requireRateLimitWindowMs, MAX_TIMER_DELAY_MS } from "veryfront/extensions/distributed/rate-limit-support";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `requireRateLimitKey` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L6) |
| `requireRateLimitWindowMs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L21) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `RateLimitEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L26) |
| `RateLimitStore` | Public API contract for rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L32) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `MAX_TIMER_DELAY_MS` | Largest delay supported consistently by JavaScript timer implementations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/limits.ts#L36) |

### `veryfront/extensions/distributed/routing-invalidation-support`

Provider-neutral routing-invalidation primitives shared with extensions.

```ts
import { hasProjectIdentityControlCharacters, isCanonicalOpaqueProjectIdentifier, parseProxyRoutingInvalidationEvent } from "veryfront/extensions/distributed/routing-invalidation-support";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `hasProjectIdentityControlCharacters` | Whether a string contains a Unicode Cc control code point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts#L23) |
| `isCanonicalOpaqueProjectIdentifier` | Whether a value is a bounded, exact opaque identifier. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts#L39) |
| `parseProxyRoutingInvalidationEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L175) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ProxyRoutingInvalidationEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L30) |
| `ProxyRoutingInvalidationPublisher` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L40) |
| `ProxyRoutingInvalidationPublishResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L34) |

### `veryfront/extensions/distributed/workflow-support`

Provider-neutral workflow helpers shared with backend extensions.

```ts
import { assertWorkflowLockId, assertWorkflowRunUpdate, assertWorkflowWorkerId } from "veryfront/extensions/distributed/workflow-support";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertWorkflowLockId` | Reject missing or whitespace-only opaque workflow lock tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L71) |
| `assertWorkflowRunUpdate` | Reject untyped callers that attempt to rewrite immutable run state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L57) |
| `assertWorkflowWorkerId` | Reject missing or whitespace-padded durable workflow owner identities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L78) |
| `captureApprovalDecisionTiming` | Validate and detach caller-owned approval decision timing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L125) |
| `capturePendingApprovalMetadataUpdate` | Capture the only approval metadata update allowed outside the decision CAS. Accessors and inherited properties are rejected before user code can run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L187) |
| `requeueRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/shared/requeue-run.ts#L8) |
| `requireWorkflowSourceIntegrationPolicy` | Require the policy snapshot that belongs to the source which created this run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/source-integration-policy.ts#L21) |
| `resolveRunDateBounds` | Validate optional date filters without invoking caller-provided methods. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/run-filter.ts#L54) |
| `resolveRunListPage` | Validate and resolve the shared built-in backend pagination contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/run-filter.ts#L66) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ApprovalDecision` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L279) |
| `ApprovalDecisionTiming` | Canonical time and expiry predicate for one approval decision attempt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L119) |
| `ApprovalExpiryCondition` | Expiry predicate evaluated in the same transaction as an approval decision. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L110) |
| `BackendConfig` | Configuration used by backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L90) |
| `Checkpoint` | Checkpoint - defined locally to use WorkflowContext interface (Zod inference doesn't handle index signatures with required properties well) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L64) |
| `PendingApproval` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L277) |
| `PendingApprovalMetadataUpdate` | Metadata that may be attached without changing an approval decision. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L105) |
| `RunFilter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L281) |
| `WorkflowBackend` | Public API contract for workflow backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L223) |
| `WorkflowQueueItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L280) |
| `WorkflowRun` | Workflow run state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L262) |
| `WorkflowRunUpdate` | Run state that may change after the immutable run snapshot is created. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L27) |
| `WorkflowStatus` | Public API contract for workflow status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L266) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `MAX_WORKFLOW_RUN_LIST_LIMIT` | Maximum workflow-run page size accepted by built-in backends and schemas. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/limits.ts#L5) |

### `veryfront/extensions/eval`

Eval category barrel: eval report exporter contracts.

```ts
import { createEvalReportExporterRegistry, redactEvalReportForExport, EvalReportExporterRegistryName } from "veryfront/extensions/eval";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `EvalReportExporterRegistryName` | Contract name used for `resolve()` / `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L16) |
| `EvalReportRedactedValue` | Sentinel used when record payload fields are removed for external export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L22) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createEvalReportExporterRegistry` | Create an eval report exporter registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L307) |
| `redactEvalReportForExport` | Create an eval report copy with external-export redaction applied. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L225) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `EvalReportExportContext` | Context passed to eval report exporters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L56) |
| `EvalReportExporter` | Vendor or backend implementation that receives sanitized eval reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L80) |
| `EvalReportExporterRegistry` | Registry contract. Single impl created at bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L109) |
| `EvalReportExportFailure` | Failed exporter result. Failures are captured so later exporters still run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L97) |
| `EvalReportExportReceipt` | Optional receipt returned by a vendor exporter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L73) |
| `EvalReportExportRedaction` | Redaction policy applied before reports leave the process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L25) |
| `EvalReportExportResult` | Result for one exporter invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L104) |
| `EvalReportExportSuccess` | Successful exporter result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L90) |
| `EvalReportExportTraceContext` | Trace correlation fields that connect eval exports to runtime spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L49) |

### `veryfront/extensions/first-party-import`

Resolve first-party extension implementations without making the root npm package statically depend on every extension dependency. Source and compiled-binary builds can load the workspace extension sources. npm builds should load the separate @veryfront/ext-* packages installed by the consuming service or app.

```ts
import { firstPartyExtensionSourceSpecifiers, importFirstPartyExtensionModule, isMissingFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `firstPartyExtensionSourceSpecifiers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L44) |
| `importFirstPartyExtensionModule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L54) |
| `isMissingFirstPartyExtensionModule` | Classify a dynamic-import failure as "the extension module itself is not installed" as opposed to a real load failure inside an installed extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L236) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `FirstPartyExtensionImportOptions` | Optional non-root entry point for a first-party extension import. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L21) |

### `veryfront/extensions/llm`

LLM category barrel - provider, embedding, and registry contracts. Interfaces re-exported with `export type { ... }` because Deno `--no-check` transpiles each file in isolation and would otherwise emit a runtime value re-export that fails ESM resolution. Reserve plain `export { ... }` for runtime values.

```ts
import { createLLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `LLMProviderRegistryName` | Contract name used for `resolve()` / `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L54) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createLLMProviderRegistry` | Create llmprovider registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider-registry.ts#L66) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `EmbeddingOptions` | Options passed to `EmbeddingProvider.embed`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L10) |
| `EmbeddingProvider` | EmbeddingProvider contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L36) |
| `EmbeddingResult` | Result returned from `EmbeddingProvider.embed`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L20) |
| `LLMProvider` | An LLM provider implementation. Extensions register one of these with the `LLMProviderRegistry` during setup(). `createModel` is required; `createEmbedding` and `createResponses` are optional and absent on providers that don't support them. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L35) |
| `LLMProviderConfig` | Config passed to any provider's create* method. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L16) |
| `LLMProviderRegistry` | Registry contract. Single impl created at bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L44) |

### `veryfront/extensions/observability`

Observability category barrel: tracing and Node telemetry contracts.

```ts
import { ApplicationErrorReporterInitializerName, NodeTelemetryProviderName } from "veryfront/extensions/observability";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ApplicationErrorReporterInitializerName` | Contract name used when an application composes a reporter through extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L39) |
| `NodeTelemetryProviderName` | Contract interface for Node.js OpenTelemetry runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L9) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ApplicationErrorContext` | Correlation context attached to an unexpected application failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L2) |
| `ApplicationErrorReporter` | Vendor-neutral application error capture and delivery contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L12) |
| `ApplicationErrorReporterInitializationContext` | Runtime context passed to an explicitly selected reporter initializer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L18) |
| `ApplicationErrorReporterInitializer` | Application-composition contract for an error-reporting implementation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L29) |
| `ApplicationErrorReporterSession` | Reporter and cleanup ownership returned by an application-selected initializer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L23) |
| `NodeTelemetryInitializeOptions` | Options accepted by node telemetry initialize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L53) |
| `NodeTelemetryInstrumentationConfig` | Configuration used by node telemetry instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L12) |
| `NodeTelemetryLogger` | Public API contract for node telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L19) |
| `NodeTelemetryLogRecord` | Structured log record shape accepted by the telemetry provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L30) |
| `NodeTelemetryLogRecordEmitter` | Emits a structured logger record into the active telemetry pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L50) |
| `NodeTelemetryProcessTarget` | Public API contract for node telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L25) |
| `NodeTelemetryProvider` | Initializes Node-specific OpenTelemetry SDK behavior. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L85) |
| `SpanData` | Data describing a single trace span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L18) |
| `TracerProvider` | Minimal TracerProvider interface for the contract. Structurally compatible with both the core shim and the real OTel SDK. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L13) |
| `TracingExporter` | TracingExporter contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L46) |

### `veryfront/extensions/parser`

Parser category barrel - CodeParser (AST traversal) contract.

```ts
import { createSkillDocumentParserProvider, snapshotSkillDocumentParserProvider, HTMLHeadLocatorName } from "veryfront/extensions/parser";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `HTMLHeadLocatorName` | Stable runtime identifier for the HTML head locator extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L2) |
| `SkillDocumentParserProviderName` | Stable runtime identifier for the Skill document parser contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L158) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createSkillDocumentParserProvider` | Create immutable provider registration metadata from a standalone parser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L261) |
| `snapshotSkillDocumentParserProvider` | Capture one immutable provider generation without retaining its mutable registration object or invoking extension-owned accessors or Proxy traps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L183) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ASTNode` | A single node in an abstract syntax tree. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L10) |
| `AuthoredImportMapState` | State of import maps authored in the parsed document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L27) |
| `CodeParser` | Public API contract for code parser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L90) |
| `FunctionDirectiveOptions` | Options for a parser-owned function directive check. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L54) |
| `GenerateOptions` | Options passed to `CodeParser.generate`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L60) |
| `GenerateResult` | Result returned from `CodeParser.generate`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L70) |
| `HtmlHeadInsertionPoint` | A source offset at which generated head content can safely be inserted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L11) |
| `HtmlHeadLocationResult` | Result of locating safe HTML head insertion positions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L57) |
| `HTMLHeadLocator` | Dependency-free contract implemented by HTML parser extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L65) |
| `HtmlHeadPlacement` | Syntax-aware insertion placement derived from a parsed HTML document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L44) |
| `HtmlModuleResolutionOrdering` | Ordering information for module-resolution consumers in the document head. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L19) |
| `InjectJsxNodePositionsOptions` | Options for `CodeParser.injectJsxNodePositions`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L84) |
| `MaxHTMLHeadParseBytes` | Literal type shared by implementations that enforce the parse-size limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L8) |
| `NodePath` | Wrapper providing traversal context for a visited node. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L22) |
| `ParseOptions` | Options passed to `CodeParser.parse`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L44) |
| `SkillDocumentParserProvider` | Dependency-free contract implemented by Skill YAML parser extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L161) |
| `TraverseVisitor` | Visitor callbacks keyed by node type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L34) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `MAX_HTML_HEAD_PARSE_BYTES` | Maximum UTF-8 input size accepted by HTML head locator implementations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/html-head-locator.ts#L5) |

### `veryfront/extensions/sandbox`

Sandbox category barrel.

```ts
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L5) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L38) |
| `SandboxShellClient` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L30) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L13) |
| `SandboxShellToolExecute` | Public API contract for sandbox shell tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L8) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L27) |
| `SandboxShellToolsProvider` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L47) |

### `veryfront/extensions/schema`

Schema category barrel - SchemaValidator contract and inference helpers.

```ts
import "veryfront/extensions/schema";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `InferInput` | Extracts the inferred *input* type from a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L111) |
| `InferSchema` | Extracts the inferred output type `T` from a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L100) |
| `InferShape` | Maps a raw object shape to its inferred object type, preserving optionality. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L114) |
| `JsonSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L18) |
| `JsonSchemaValidationFailure` | Failed validation of an input against a compiled JSON Schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L173) |
| `JsonSchemaValidationFunction` | Compiled, reusable JSON Schema validation function. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L185) |
| `JsonSchemaValidationIssue` | Stable validation issue copied from a JSON Schema validator result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L152) |
| `JsonSchemaValidationResult` | Result returned by a compiled JSON Schema validator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L180) |
| `JsonSchemaValidationSuccess` | Successful validation of an input against a compiled JSON Schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L166) |
| `RefinementCtx` | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L92) |
| `Schema` | An opaque schema definition that validates and infers type `T`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L22) |
| `SchemaFactory` | Factory type accepted by `defineSchema`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L305) |
| `SchemaValidator` | SchemaValidator contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L207) |
| `SchemaValidatorCoerce` | Namespace for `coerce.*` constructors - accepts input in any form and coerces to the target type before validation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L193) |
| `ValidationFailure` | Failed validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L140) |
| `ValidationIssue` | A single validation issue with location context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L123) |
| `ValidationResult` | Discriminated union of validation outcomes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L149) |
| `ValidationSuccess` | Successful validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L133) |

### `veryfront/extensions/skill`

Contracts for extension-owned skill execution implementations.

```ts
import { snapshotSkillScriptExecutorProvider, snapshotSkillScriptPreparedExecution, SkillScriptExecutorProviderName } from "veryfront/extensions/skill";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `SkillScriptExecutorProviderName` | Contract name registered by one composed script-execution extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L48) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `snapshotSkillScriptExecutorProvider` | Capture a provider and validate inert controls before returning ownership. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L711) |
| `snapshotSkillScriptPreparedExecution` | Capture inert controls without retaining mutable method properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L433) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `SkillScriptExecutionHandle` | Core-owned execution lifecycle returned to application composition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L67) |
| `SkillScriptExecutionReporter` | Provider callbacks used to report one result and one terminal settlement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L51) |
| `SkillScriptExecutorProvider` | Extension-owned implementation selected by application composition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L78) |
| `SkillScriptExecutorProviderInput` | Canonical detached input delivered to a composed execution provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L75) |
| `SkillScriptExecutorProviderSnapshot` | Validated provider facade that owns settlement promises for its caller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L92) |
| `SkillScriptPreparedExecution` | Inert provider-owned controls returned before execution begins. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/skill/script-executor-provider.ts#L59) |

### `veryfront/extensions/websocket`

Contracts for extension-owned Node.js WebSocket implementations.

```ts
import { captureNodeWebSocketServer, createNodeWebSocketServerProvider, snapshotNodeWebSocketServerProvider } from "veryfront/extensions/websocket";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `NodeWebSocketServerProviderName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L11) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `captureNodeWebSocketServer` | Capture one server instance without retaining mutable method lookups. The underlying implementation remains the receiver because protocol engines legitimately keep mutable transport state on their instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L142) |
| `createNodeWebSocketServerProvider` | Create immutable registration metadata from a standalone factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L231) |
| `snapshotNodeWebSocketServerProvider` | Capture a provider generation without retaining its mutable registration object or invoking extension-owned accessors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L189) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `NodeWebSocketConnection` | Minimal connection surface consumed by core's runtime-neutral adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L24) |
| `NodeWebSocketMessageData` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L18) |
| `NodeWebSocketServer` | Minimal server surface used by upgrade and shutdown ownership. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L50) |
| `NodeWebSocketServerOptions` | Exact no-server options supplied by core for an existing HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L41) |
| `NodeWebSocketServerProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L66) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L13) |
| `NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L12) |
