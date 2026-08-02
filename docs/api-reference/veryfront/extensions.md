---
title: "veryfront/extensions"
description: "Extension authoring types and runtime helpers."
order: 9
---

## Import

```ts
import {
  assertImageOptimizationEngine,
  assertSystemReadCapability,
  auditCapabilities,
  captureImageOptimizationEngine,
  captureRedisRuntimeProvider,
  composeAbortSignals,
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
| `CIRCULAR_DEPENDENCY_ERROR` | Shared circular dependency error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L28) |
| `EXTENSION_CONFLICT_ERROR` | Shared extension conflict error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L37) |
| `EXTENSION_VALIDATION_ERROR` | Shared extension validation error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L19) |
| `ImageOptimizationEngineName` | Registry name used for the image optimization extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L22) |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L25) |
| `MISSING_EXTENSION_ERROR` | Shared missing extension error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L10) |
| `RedisRuntimeProviderName` | Registry name used by the Redis runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L18) |
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L5) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertImageOptimizationEngine` | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L137) |
| `assertSystemReadCapability` | Validate the bounded scope required by a `system:read` capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L145) |
| `auditCapabilities` | Log capabilities for a named extension at startup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L280) |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L144) |
| `captureRedisRuntimeProvider` | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L485) |
| `composeAbortSignals` | Compose cancellation sources without depending on a mutable host `AbortSignal.any` implementation. The first source to abort owns the exact propagated reason, and listeners on every remaining source are detached immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/abort-signal.ts#L7) |
| `detectConflicts` | Detect contract conflicts between resolved extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L155) |
| `discoverLocalExtensions` | Find `*.extension.ts` files in the project root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L543) |
| `discoverPackageExtensions` | Discover auto-activated package extensions without exposing identity internals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L396) |
| `discoverProjectExtensions` | Discover project extension paths without exposing identity internals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L530) |
| `formatCapabilities` | Format capabilities as human-readable strings for logging. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L24) |
| `getRecommendation` | Return recommendation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/recommendations.ts#L34) |
| `isSupportedDenoSystemReadApi` | Return whether a Deno system permission name is explicitly read-only. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L69) |
| `loadExtensionFactory` | Dynamically import an extension factory from `path` and resolve it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/factory-loader.ts#L100) |
| `mapToDenoPermissions` | Map capabilities to Deno CLI permission flags. Skips capabilities without a Deno permission mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L236) |
| `mergeExtensions` | Merge extensions from all four sources in priority order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L225) |
| `orchestrateExtensions` | Run the full extension pipeline against a resolved project config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L125) |
| `parsePackageMetadata` | Parse veryfront extension metadata from a package.json-like object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L185) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L13) |
| `tryResolve` | Try to resolve. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L28) |
| `validateExtension` | Validate the shape of an extension object. Returns an array of issue descriptions (empty array = valid). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L85) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ExtensionLoader` | Implement extension loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts#L31) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Capability` | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L11) |
| `ConflictInfo` | Information about a contract conflict between extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L13) |
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L38) |
| `DiscoveredPackageExtension` | A package extension whose manifest is bound to one physical import target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L42) |
| `Extension` | Public API contract for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L46) |
| `ExtensionActivationMode` | Controls whether installation alone may activate an extension package. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L39) |
| `ExtensionConfigEntry` | Entry shape for extension config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L61) |
| `ExtensionContext` | Context for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L27) |
| `ExtensionContractMetadata` | Public API contract for extension contract metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L17) |
| `ExtensionFactory` | Public API contract for extension factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L58) |
| `ExtensionLogger` | Public API contract for extension logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L38) |
| `ExtensionSource` | Public API contract for extension source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L66) |
| `ImageOptimizationEngine` | Image decoder, resizer, and encoder implemented by an explicit extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L71) |
| `ImageOptimizationFormat` | Formats core can request from an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L29) |
| `ImageOptimizationRequest` | Immutable byte-oriented request supplied by core. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L32) |
| `ImageOptimizationResult` | Portable result returned by an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L56) |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L48) |
| `OrchestrateOptions` | Options for `orchestrateExtensions`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L30) |
| `PackageMetadata` | Metadata extracted from a package.json that declares itself as a veryfront extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L27) |
| `RedisRuntimeProvider` | Optional Redis runtime implementation supplied by an extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L150) |
| `ResolvedExtension` | Public API contract for resolved extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L74) |
| `SandboxShellClient` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L30) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L13) |
| `SandboxShellToolExecute` | Public API contract for sandbox shell tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L8) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L27) |
| `SandboxShellToolsProvider` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L47) |

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
| `TokenCacheEntry` | A cache entry stored by `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L19) |
| `TokenCacheStats` | Aggregate usage statistics for a `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L30) |
| `TokenCacheStore` | TokenCacheStore contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L43) |

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
| `DocumentExtractor` | Document extraction contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L69) |
| `KreuzbergExtractor` | Shape returned by the kreuzberg document-extraction module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L41) |
| `SqliteDatabase` | Minimal interface for a SQLite database connection, compatible with `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L30) |
| `SqliteStatement` | Minimal interface for a prepared SQLite statement, compatible with `better-sqlite3`'s `Statement` shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L15) |
| `SqliteStore` | SQLite-backed storage contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L94) |

### `veryfront/extensions/content`

Content category barrel for the MDX/Markdown content processor contract.

```ts
import "veryfront/extensions/content";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CompilationMode` | Compilation mode. Dev surfaces extra diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L23) |
| `CompilationTarget` | Where the output is destined: server-side RSC or browser bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L26) |
| `ContentCompileOptions` | Options for `ContentProcessor.compileMdx` and `ContentProcessor.compileMarkdown`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L45) |
| `ContentPlugin` | Opaque unified-compatible plugin entry. Kept as an unknown-typed value or tuple so the contract surface doesn't require consumers to depend on the `unified` package directly. Callers cast to the plugin-list shape they need. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L75) |
| `ContentProcessingResult` | Processing result returned by the content pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L29) |
| `ContentProcessor` | ContentProcessor contract for MDX/Markdown processing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L89) |

### `veryfront/extensions/contracts`

Contract registry - runtime resolution of extension-provided implementations.

```ts
import { register, reset, resolve } from "veryfront/extensions/contracts";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `register` | Register. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L33) |
| `reset` | Reset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L43) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L13) |
| `tryResolve` | Try to resolve. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L28) |
| `unregister` | Unregister. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L38) |

### `veryfront/extensions/css`

CSS category barrel - CSS compilation and optimization contracts.

```ts
import { assertCSSOptimizationEngine, assertCSSProcessor, assertCSSPurgingEngine } from "veryfront/extensions/css";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `CSSOptimizationEngineName` | Registry name used for the CSS optimization extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L21) |
| `CSSProcessorName` | Registry name used for the CSS compiler extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L30) |
| `CSSPurgingEngineName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L20) |
| `MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the runtime boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L24) |
| `MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L32) |
| `MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L31) |
| `MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L21) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCSSOptimizationEngine` | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L113) |
| `assertCSSProcessor` | Validate an implementation received through the dynamic extension registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L166) |
| `assertCSSPurgingEngine` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L94) |
| `captureCSSCompiler` | Capture a compiler method once so accessors and later mutation cannot redirect a build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L98) |
| `captureCSSOptimizationEngine` | Capture dynamic properties once so later mutation or accessors cannot change the implementation that core invokes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L123) |
| `captureCSSProcessor` | Capture the complete processor surface once. A registry or implementation mutation can therefore affect only a subsequently acquired operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L174) |
| `captureCSSPurgingEngine` | Capture identity and method once so registry mutation cannot split a run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L99) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CSSCompiler` | Stateful compiler returned by `CSSProcessor.compile`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L37) |
| `CSSOptimizationEngine` | Parser-backed CSS optimization contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L46) |
| `CSSOptimizationRequest` | Immutable optimization request supplied by core. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L27) |
| `CSSOptimizationResult` | Portable output returned by a CSS optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L35) |
| `CSSProcessor` | CSSProcessor contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L53) |
| `CSSPurgeContentSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L23) |
| `CSSPurgingEngine` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L40) |
| `CSSPurgingRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L28) |
| `CSSPurgingResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L35) |

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

### `veryfront/extensions/distributed`

Provider-neutral contracts for optional distributed runtime infrastructure.

```ts
import { captureRedisRuntimeProvider, RedisRuntimeProviderName } from "veryfront/extensions/distributed";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `RedisRuntimeProviderName` | Registry name used by the Redis runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L18) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `captureRedisRuntimeProvider` | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L485) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `NodeRedisClient` | Structural node-redis client surface used by the platform adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L36) |
| `NodeRedisModule` | Structural module surface used by the platform Redis adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L21) |
| `RedisClient` | Structural client surface used by core cache features. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L91) |
| `RedisClientHandle` | Independently owned Redis connection returned to a core feature. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L116) |
| `RedisClientOptions` | Connection options accepted by the stable core Redis client facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L122) |
| `RedisEventPublisherConfig` | Redis Pub/Sub publisher configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L132) |
| `RedisEventPublisherImplementation` | Redis-backed event publisher/subscriber implementation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L142) |
| `RedisRuntimeProvider` | Optional Redis runtime implementation supplied by an extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L150) |

### `veryfront/extensions/eval`

Eval category barrel: eval report exporter contracts.

```ts
import { createEvalReportExporterRegistry, redactEvalReportForExport, EvalReportExporterRegistryName } from "veryfront/extensions/eval";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `EvalReportExporterRegistryName` | Contract name used for `resolve()` / `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L14) |
| `EvalReportRedactedValue` | Sentinel used when record payload fields are removed for external export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L20) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createEvalReportExporterRegistry` | Create an eval report exporter registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L303) |
| `redactEvalReportForExport` | Create an eval report copy with external-export redaction applied. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L223) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `EvalReportExportContext` | Context passed to eval report exporters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L54) |
| `EvalReportExporter` | Vendor or backend implementation that receives sanitized eval reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L78) |
| `EvalReportExporterRegistry` | Registry contract. Single impl created at bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L107) |
| `EvalReportExportFailure` | Failed exporter result. Failures are captured so later exporters still run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L95) |
| `EvalReportExportReceipt` | Optional receipt returned by a vendor exporter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L71) |
| `EvalReportExportRedaction` | Redaction policy applied before reports leave the process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L23) |
| `EvalReportExportResult` | Result for one exporter invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L102) |
| `EvalReportExportSuccess` | Successful exporter result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L88) |
| `EvalReportExportTraceContext` | Trace correlation fields that connect eval exports to runtime spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L47) |

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

### `veryfront/extensions/image`

Image extension contracts.

```ts
import { assertImageOptimizationEngine, captureImageOptimizationEngine, ImageOptimizationEngineName } from "veryfront/extensions/image";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ImageOptimizationEngineName` | Registry name used for the image optimization extension contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L22) |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L25) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertImageOptimizationEngine` | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L137) |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L144) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ImageOptimizationEngine` | Image decoder, resizer, and encoder implemented by an explicit extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L71) |
| `ImageOptimizationFormat` | Formats core can request from an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L29) |
| `ImageOptimizationRequest` | Immutable byte-oriented request supplied by core. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L32) |
| `ImageOptimizationResult` | Portable result returned by an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L56) |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L48) |

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
| `createLLMProviderRegistry` | Create llmprovider registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider-registry.ts#L49) |

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
import { NodeTelemetryProviderName } from "veryfront/extensions/observability";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `NodeTelemetryProviderName` | Contract interface for Node.js OpenTelemetry runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L9) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
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
import "veryfront/extensions/parser";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ASTNode` | A single node in an abstract syntax tree. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L10) |
| `CodeParser` | Public API contract for code parser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L90) |
| `FunctionDirectiveOptions` | Options for a parser-owned function directive check. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L54) |
| `GenerateOptions` | Options passed to `CodeParser.generate`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L60) |
| `GenerateResult` | Result returned from `CodeParser.generate`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L70) |
| `InjectJsxNodePositionsOptions` | Options for `CodeParser.injectJsxNodePositions`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L84) |
| `NodePath` | Wrapper providing traversal context for a visited node. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L22) |
| `ParseOptions` | Options passed to `CodeParser.parse`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L44) |
| `TraverseVisitor` | Visitor callbacks keyed by node type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L34) |

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
| `JsonSchema` | Minimal JSON Schema type used by the `SchemaValidator` contract for `toJsonSchema()`. Kept in the extensions/schema category so the contract can reference it without depending on any non-leaf module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L9) |
| `RefinementCtx` | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L92) |
| `Schema` | An opaque schema definition that validates and infers type `T`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L22) |
| `SchemaFactory` | Factory type accepted by `defineSchema`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L257) |
| `SchemaValidator` | SchemaValidator contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L169) |
| `SchemaValidatorCoerce` | Namespace for `coerce.*` constructors - accepts input in any form and coerces to the target type before validation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L155) |
| `ValidationFailure` | Failed validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L140) |
| `ValidationIssue` | A single validation issue with location context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L123) |
| `ValidationResult` | Discriminated union of validation outcomes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L149) |
| `ValidationSuccess` | Successful validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L133) |

### `veryfront/extensions/types`

Core types for the veryfront extension system.

```ts
import "veryfront/extensions/types";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `Capability` | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L11) |
| `Extension` | Public API contract for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L46) |
| `ExtensionConfigEntry` | Entry shape for extension config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L61) |
| `ExtensionContext` | Context for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L27) |
| `ExtensionContractMetadata` | Public API contract for extension contract metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L17) |
| `ExtensionFactory` | Public API contract for extension factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L58) |
| `ExtensionLogger` | Public API contract for extension logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L38) |
| `ExtensionSource` | Public API contract for extension source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L66) |
| `PackageContractMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L24) |
| `ResolvedExtension` | Public API contract for resolved extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L74) |

### `veryfront/extensions/websocket`

Contracts for extension-owned Node.js WebSocket implementations.

```ts
import { captureNodeWebSocketServer, createNodeWebSocketServerProvider, snapshotNodeWebSocketServerProvider } from "veryfront/extensions/websocket";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L13) |
| `NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L12) |
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
