---
title: "veryfront/extensions"
description: "Extension authoring types and runtime helpers."
order: 8
---

## Import

```ts
import {
  auditCapabilities,
  detectConflicts,
  discoverLocalExtensions,
  discoverPackageExtensions,
  discoverProjectExtensions,
  formatCapabilities,
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
| `CIRCULAR_DEPENDENCY_ERROR` | Registered error definition for the extension-circular-dependency slug. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L119) |
| `EXTENSION_CONFLICT_ERROR` | Registered error definition for the extension-conflict slug. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L128) |
| `EXTENSION_SETUP_TIMEOUT_ERROR` | Registered error definition for the extension-setup-timeout slug. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L107) |
| `EXTENSION_VALIDATION_ERROR` | Registered error definition for the extension-validation slug. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L110) |
| `MISSING_EXTENSION_ERROR` | Registered error definition for the missing-extension slug. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L98) |
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L9) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `auditCapabilities` | Log capabilities for a named extension at startup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L296) |
| `detectConflicts` | Detect contract conflicts between resolved extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L327) |
| `discoverLocalExtensions` | Find `*.extension.ts` files in the project root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L553) |
| `discoverPackageExtensions` | Scan `node_modules` (including `@scoped` packages) for packages that declare veryfront extension metadata in their `package.json`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L464) |
| `discoverProjectExtensions` | Discover project extensions living under `extensions/` in the project root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L527) |
| `formatCapabilities` | Format capabilities as human-readable strings for logging. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L142) |
| `getRecommendation` | Return recommendation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/recommendations.ts#L29) |
| `loadExtensionFactory` | Dynamically import an extension factory from `path` and resolve it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/factory-loader.ts#L44) |
| `mapToDenoPermissions` | Map capabilities to Deno CLI permission flags. Skips capabilities without a Deno permission mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L240) |
| `mergeExtensions` | Merge extensions from all four sources in priority order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L261) |
| `orchestrateExtensions` | Run the full extension pipeline against a resolved project config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L125) |
| `parsePackageMetadata` | Parse veryfront extension metadata from a package.json-like object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L218) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L31) |
| `tryResolve` | Try to resolve. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L47) |
| `validateExtension` | Validate the shape of an extension object. Returns an array of issue descriptions (empty array = valid). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L136) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ExtensionLoader` | Implement extension loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts#L75) |
| `VeryfrontError` | Veryfront Error class with slug-based error identity | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L285) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Capability` | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L11) |
| `ConflictInfo` | Information about a contract conflict between extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L30) |
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L89) |
| `ErrorCategory` | Error categories for domain-based grouping and handling | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L7) |
| `ErrorCreateOptions` | Options for creating an error instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L64) |
| `ErrorDefinition` | Error definition for the registry | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L48) |
| `Extension` | Public API contract for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L63) |
| `ExtensionConfigEntry` | Entry shape for extension config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L91) |
| `ExtensionContext` | Context for extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L27) |
| `ExtensionContractMetadata` | Public API contract for extension contract metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L19) |
| `ExtensionFactory` | Public API contract for extension factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L88) |
| `ExtensionLogger` | Public API contract for extension logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L43) |
| `ExtensionSource` | Public API contract for extension source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L96) |
| `ExtensionTeardownContext` | Context passed to an extension while its resources are released. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L55) |
| `OrchestrateOptions` | Options for `orchestrateExtensions`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L48) |
| `PackageMetadata` | Metadata extracted from a package.json that declares itself as a veryfront extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L61) |
| `RegisteredError` | Registered error with factory method | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L82) |
| `ResolvedExtension` | Public API contract for resolved extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L104) |
| `RFC9457Response` | RFC 9457 Problem Details response shape | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L23) |
| `SandboxShellClient` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L81) |
| `SandboxShellToolAnnotations` | Behavioral hints exposed to MCP clients for a sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L36) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L64) |
| `SandboxShellToolExecute` | Public API contract for sandbox shell tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L28) |
| `SandboxShellToolExecutionContext` | Execution context accepted by sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L20) |
| `SandboxShellToolJsonSchema` | JSON Schema object with typed common keywords and support for draft-specific or vendor-defined keywords. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L24) |
| `SandboxShellToolJsonSchemaTypeName` | Primitive type names accepted by JSON Schema's `type` keyword. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L11) |
| `SandboxShellToolMcpConfig` | MCP metadata accepted on a sandbox shell tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L48) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L78) |
| `SandboxShellToolsProvider` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L98) |
| `SandboxShellToolType` | Tool type values accepted by sandbox shell tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L12) |
| `SetupAllOptions` | Options for {@link ExtensionLoader.setupAll}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts#L58) |
| `TeardownAllOptions` | Options for {@link ExtensionLoader.teardownAll}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts#L69) |
| `VeryfrontErrorOptions` | Options for VeryfrontError constructor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L228) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/extensions/auth`

Auth category barrel for the AuthProvider contract and token shapes.

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

Bundler category barrel for the Bundler contract, module lexer, and resolver helper.

```ts
import { build, context, getBundler } from "veryfront/extensions/bundler";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `build` | Convenience wrapper: `bundler.bundle(opts)`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L81) |
| `context` | Create an incremental build context (watch/rebuild mode). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L108) |
| `getBundler` | Resolve the registered `Bundler` contract. Throws if no extension provides it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L76) |
| `stop` | Stop the bundler. This is optional because extension teardown also calls it. Provided so tests that previously called `esbuild.stop()` keep working. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L102) |
| `transform` | Convenience wrapper that mirrors esbuild's `transform(code, options)` positional signature so call-sites migrating off esbuild keep their shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L90) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BuildContext` | Incremental/rebuild context produced by {@link Bundler.context}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L313) |
| `BuildFailure` | Failure thrown by {@link Bundler.bundle} or {@link Bundler.transform}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L321) |
| `BuildOptions` | Options passed to {@link Bundler.bundle}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L84) |
| `BuildResult` | Result returned from {@link Bundler.bundle}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L144) |
| `BundleOptions` | Options passed to {@link Bundler.bundle}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L84) |
| `BundleOutput` | A single output file produced by a bundle operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L132) |
| `Bundler` | Bundler contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L334) |
| `BundleResult` | Result returned from {@link Bundler.bundle}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L144) |
| `BundlerMessage` | A diagnostic message (error or warning) from a bundler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L24) |
| `BundlerMessageLocation` | Location of an error or warning in source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L10) |
| `BundlerPlugin` | A bundler plugin that hooks into the build pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L305) |
| `BundlerPluginBuild` | Build context exposed to bundler plugins. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L275) |
| `ImportSpecifier` | A single import specifier position record, matching the shape produced by `es-module-lexer`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L18) |
| `Loader` | Loader hint for source files. Mirrors esbuild's `Loader` type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L156) |
| `Message` | A diagnostic message (error or warning) from a bundler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L24) |
| `Metafile` | Dependency-graph metadata produced by a bundler when `metafile: true`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L64) |
| `MetafileInput` | Input file entry in a {@link Metafile}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L38) |
| `MetafileOutput` | Output file entry in a {@link Metafile}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L48) |
| `ModuleLexer` | Module lexer contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L41) |
| `OnLoadArgs` | Arguments passed to an `onLoad` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L245) |
| `OnLoadResult` | Result returned from an `onLoad` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L257) |
| `OnResolveArgs` | Arguments passed to an `onResolve` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L209) |
| `OnResolveResult` | Result returned from an `onResolve` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L225) |
| `Plugin` | A bundler plugin that hooks into the build pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L305) |
| `PluginBuild` | Build context exposed to bundler plugins. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L275) |
| `ResolveResult` | Result returned from an `onResolve` callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L225) |
| `StdinOptions` | In-memory source input for {@link BundleOptions.stdin}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L72) |
| `TransformOptions` | Options passed to {@link Bundler.transform}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L173) |
| `TransformResult` | Result returned from {@link Bundler.transform}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L199) |

### `veryfront/extensions/cache`

Cache category barrel for generic cache and proxy-grade token cache contracts.

```ts
import "veryfront/extensions/cache";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CacheStore` | CacheStore contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/cache-store.ts#L14) |
| `TokenCacheEntry` | A cache entry stored by `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L19) |
| `TokenCacheStats` | Aggregate usage statistics for a `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L33) |
| `TokenCacheStore` | TokenCacheStore contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L50) |

### `veryfront/extensions/compat`

Compat category barrel for optional native runtime services.

```ts
import "veryfront/extensions/compat";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DocumentExtractionOptions` | Controls document extraction progress and timeout behavior. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L73) |
| `DocumentExtractionProgress` | Callback invoked when document extraction progress changes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L68) |
| `DocumentExtractionProgressEvent` | Progress reported while a document is being extracted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L56) |
| `DocumentExtractor` | Document extraction contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L85) |
| `KreuzbergExtractor` | Shape returned by the kreuzberg document-extraction module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L46) |
| `SqliteDatabase` | Minimal interface for a SQLite database connection, compatible with `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L32) |
| `SqliteStatement` | Minimal interface for a prepared SQLite statement, compatible with `better-sqlite3`'s `Statement` shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L15) |
| `SqliteStore` | SQLite-backed storage contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L110) |

### `veryfront/extensions/content`

Content category barrel for the MDX/Markdown content processor contract.

```ts
import "veryfront/extensions/content";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CompilationMode` | Compilation mode. Dev surfaces extra diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L18) |
| `CompilationTarget` | Where the output is destined: server-side RSC or browser bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L21) |
| `ContentCompileOptions` | Options for {@link ContentProcessor.compileMdx} and {@link ContentProcessor.compileMarkdown}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L40) |
| `ContentPlugin` | Opaque unified-compatible plugin entry. The contract deliberately leaves plugin values unknown so consumers do not need the `unified` package only to implement this extension boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L70) |
| `ContentProcessingResult` | Processing result returned by the content pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L24) |
| `ContentProcessor` | ContentProcessor contract for MDX/Markdown processing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L84) |

### `veryfront/extensions/contracts`

Contract registry for runtime resolution of extension-provided implementations.

```ts
import { register, reset, resolve } from "veryfront/extensions/contracts";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `register` | Register. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L53) |
| `reset` | Reset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L78) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L31) |
| `tryResolve` | Try to resolve. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L47) |
| `unregister` | Unregister. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L72) |

### `veryfront/extensions/css`

CSS category barrel for CSS processor and compiler contracts.

```ts
import "veryfront/extensions/css";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CSSCompileOptions` | Options passed to {@link CSSProcessor.compile}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L38) |
| `CSSCompiler` | Stateful compiler returned by {@link CSSProcessor.compile}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L48) |
| `CSSModuleSource` | A loaded module (Tailwind plugin). `module` is the plugin's default export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L28) |
| `CSSProcessor` | CSSProcessor contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L64) |
| `CSSStylesheetSource` | A loaded stylesheet body with the base path used to resolve relative imports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L18) |

### `veryfront/extensions/database`

Database category barrel for the DatabaseClient contract.

```ts
import "veryfront/extensions/database";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DatabaseClient` | DatabaseClient contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L23) |
| `QueryResult` | Result returned from {@link DatabaseClient.query}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L10) |

### `veryfront/extensions/eval`

Eval category barrel: eval report exporter contracts.

```ts
import { createEvalReportExporterRegistry, redactEvalReportForExport, EvalReportExporterRegistryName } from "veryfront/extensions/eval";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `EvalReportExporterRegistryName` | Contract name used for `resolve()` and `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L12) |
| `EvalReportRedactedValue` | Sentinel used when record payload fields are removed for external export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L15) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createEvalReportExporterRegistry` | Create an eval report exporter registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-registry.ts#L224) |
| `redactEvalReportForExport` | Create an eval report copy with external-export redaction applied. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-redaction.ts#L566) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `EvalReport` | JSON-serializable report produced by `runEval`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts#L799) |
| `EvalReportExportContext` | Context passed to eval report exporters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L59) |
| `EvalReportExporter` | Vendor or backend implementation that receives sanitized eval reports. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L99) |
| `EvalReportExporterRegistry` | Registry contract. A single implementation is created at bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L135) |
| `EvalReportExportFailure` | Failed exporter result. Failures are captured so later exporters still run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L120) |
| `EvalReportExportMaybePromise` | Value that can be returned synchronously or as a promise. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L18) |
| `EvalReportExportReceipt` | Optional receipt returned by a vendor exporter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L89) |
| `EvalReportExportRedaction` | Redaction policy applied before reports leave the process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L21) |
| `EvalReportExportResult` | Result for one exporter invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L130) |
| `EvalReportExportSuccess` | Successful exporter result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L110) |
| `EvalReportExportTraceContext` | Trace correlation fields that connect eval exports to runtime spans. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter-contract.ts#L49) |

### `veryfront/extensions/first-party-import`

Resolve first-party extension implementations without making the root npm package statically depend on every extension dependency. Source and compiled-binary builds can load the workspace extension sources. npm builds should load the separate @veryfront/ext-* packages installed by the consuming service or app.

```ts
import { firstPartyExtensionSourceSpecifiers, importFirstPartyExtensionModule, isMissingFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `firstPartyExtensionSourceSpecifiers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L22) |
| `importFirstPartyExtensionModule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L28) |
| `isMissingFirstPartyExtensionModule` | Classify a dynamic-import failure as "the extension module itself is not installed" as opposed to a real load failure inside an installed extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L88) |

### `veryfront/extensions/llm`

LLM category barrel for provider, embedding, and registry contracts. Interfaces re-exported with `export type { ... }` because Deno `--no-check` transpiles each file in isolation and would otherwise emit a runtime value re-export that fails ESM resolution. Reserve plain `export { ... }` for runtime values.

```ts
import { createLLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `LLMProviderRegistryName` | Contract name used for `resolve()` / `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L65) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createLLMProviderRegistry` | Create an LLM provider registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider-registry.ts#L181) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `EmbeddingOptions` | Options passed to {@link EmbeddingProvider.embed}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L10) |
| `EmbeddingProvider` | EmbeddingProvider contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L36) |
| `EmbeddingResult` | Result returned from {@link EmbeddingProvider.embed}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L20) |
| `EmbeddingRuntime` | Public API contract for an embedding runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L46) |
| `LLMProvider` | An LLM provider implementation. Extensions register one of these with the {@link LLMProviderRegistry} during setup(). `createModel` is required; `createEmbedding` and `createResponses` are optional and absent on providers that don't support them. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L37) |
| `LLMProviderConfig` | Config passed to any provider's create* method. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L18) |
| `LLMProviderRegistry` | Registry contract. Single impl created at bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L49) |
| `ModelRuntime` | Public API contract for model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L34) |

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
| `NodeTelemetryInitializeOptions` | Options accepted by node telemetry initialize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L55) |
| `NodeTelemetryInstrumentationConfig` | Configuration used by node telemetry instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L12) |
| `NodeTelemetryLogger` | Public API contract for node telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L19) |
| `NodeTelemetryLogRecord` | Structured log record shape accepted by the telemetry provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L30) |
| `NodeTelemetryLogRecordEmitter` | Emits a structured logger record into the active telemetry pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L52) |
| `NodeTelemetryProcessTarget` | Public API contract for node telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L25) |
| `NodeTelemetryProvider` | Initializes Node-specific OpenTelemetry SDK behavior. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L87) |
| `SpanData` | Data describing a single trace span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L21) |
| `TracerProvider` | Minimal TracerProvider interface for the contract. Structurally compatible with both the core shim and the real OTel SDK. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L15) |
| `TracingExporter` | TracingExporter contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L49) |

### `veryfront/extensions/parser`

Parser category barrel for the CodeParser AST traversal contract.

```ts
import "veryfront/extensions/parser";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ASTNode` | A single node in an abstract syntax tree. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L10) |
| `CodeParser` | Public API contract for code parser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L93) |
| `FunctionDirectiveOptions` | Options for a parser-owned function directive check. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L57) |
| `GenerateOptions` | Options passed to {@link CodeParser.generate}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L63) |
| `GenerateResult` | Result returned from {@link CodeParser.generate}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L73) |
| `InjectJsxNodePositionsOptions` | Options for {@link CodeParser.injectJsxNodePositions}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L87) |
| `NodePath` | Wrapper providing traversal context for a visited node. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L22) |
| `ParseOptions` | Options passed to {@link CodeParser.parse}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L47) |
| `TraverseVisitor` | Visitor callbacks keyed by node type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L36) |

### `veryfront/extensions/sandbox`

Sandbox category barrel.

```ts
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L9) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L89) |
| `SandboxShellClient` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L81) |
| `SandboxShellToolAnnotations` | Behavioral hints exposed to MCP clients for a sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L36) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L64) |
| `SandboxShellToolExecute` | Public API contract for sandbox shell tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L28) |
| `SandboxShellToolExecutionContext` | Execution context accepted by sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L20) |
| `SandboxShellToolJsonSchema` | JSON Schema object with typed common keywords and support for draft-specific or vendor-defined keywords. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L24) |
| `SandboxShellToolJsonSchemaTypeName` | Primitive type names accepted by JSON Schema's `type` keyword. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L11) |
| `SandboxShellToolMcpConfig` | MCP metadata accepted on a sandbox shell tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L48) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L78) |
| `SandboxShellToolsProvider` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L98) |
| `SandboxShellToolType` | Tool type values accepted by sandbox shell tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L12) |

### `veryfront/extensions/schema`

Schema category barrel for the SchemaValidator contract and inference helpers.

```ts
import "veryfront/extensions/schema";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `InferInput` | Extracts the inferred *input* type from a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L130) |
| `InferSchema` | Extracts the inferred output type `T` from a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L119) |
| `InferShape` | Maps a raw object shape to its inferred object type, preserving optionality. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L133) |
| `JsonSchema` | JSON Schema object with typed common keywords and support for draft-specific or vendor-defined keywords. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L24) |
| `JsonSchemaTypeName` | Primitive type names accepted by JSON Schema's `type` keyword. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L11) |
| `RefinementCtx` | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L111) |
| `Schema` | An opaque schema definition that validates and infers type `T`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L22) |
| `SchemaFactory` | Factory type accepted by `defineSchema`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L297) |
| `SchemaValidator` | SchemaValidator contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L194) |
| `SchemaValidatorCoerce` | Namespace for `coerce.*` constructors. It accepts input in any form and coerces to the target type before validation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L176) |
| `ValidationFailure` | Failed validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L160) |
| `ValidationIssue` | A single validation issue with location context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L142) |
| `ValidationResult` | Discriminated union of validation outcomes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L170) |
| `ValidationSuccess` | Successful validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L152) |
