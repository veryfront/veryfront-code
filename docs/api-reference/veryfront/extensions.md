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

| Name                                                | Description                                                          | Source                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CIRCULAR_DEPENDENCY_ERROR`                         | Shared circular dependency error value.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts)                             |
| `EXTENSION_CONFLICT_ERROR`                          | Shared extension conflict error value.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts)                             |
| `EXTENSION_VALIDATION_ERROR`                        | Shared extension validation error value.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts)                             |
| `ImageOptimizationEngineName`                       | Registry name used for the image optimization extension contract.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `MISSING_EXTENSION_ERROR`                           | Shared missing extension error value.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts)                             |
| `RedisRuntimeProviderName`                          | Registry name used by the Redis runtime extension.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `SandboxShellToolsProviderName`                     | Render sandbox shell tools provider name.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts)                |

### Functions

| Name                             | Description                                                                                                                                                                                                                      | Source                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `assertImageOptimizationEngine`  | Validate an implementation received through the dynamic contract registry.                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `assertSystemReadCapability`     | Validate the bounded scope required by a `system:read` capability.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts)                       |
| `auditCapabilities`              | Log capabilities for a named extension at startup.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts)                       |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations.                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `captureRedisRuntimeProvider`    | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `composeAbortSignals`            | Compose cancellation sources without depending on a mutable host `AbortSignal.any` implementation. The first source to abort owns the exact propagated reason, and listeners on every remaining source are detached immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/abort-signal.ts)                       |
| `detectConflicts`                | Detect contract conflicts between resolved extensions.                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts)                         |
| `detectProjectInstallTarget`     | Return the client the project at `projectDirectory` installs with, or `undefined` when no manifest is readable (a hosted render, a directory without read permission, a runtime with no synchronous filesystem).                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts)                    |
| `discoverLocalExtensions`        | Find `*.extension.ts` files in the project root.                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `discoverPackageExtensions`      | Discover auto-activated package extensions without exposing identity internals.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `discoverProjectExtensions`      | Discover project extension paths without exposing identity internals.                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `formatCapabilities`             | Format capabilities as human-readable strings for logging.                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts)                       |
| `formatInstallCommand`           | Return the command that installs `packageName` with `target`.                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts)                    |
| `getRecommendation`              | Return recommendation.                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/recommendations.ts)                    |
| `isSupportedDenoSystemReadApi`   |                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts)                       |
| `loadExtensionFactory`           | Dynamically import an extension factory from `path` and resolve it.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/factory-loader.ts)                     |
| `mapToDenoPermissions`           | Map capabilities to Deno CLI permission flags.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts)                       |
| `mergeExtensions`                | Merge extensions from all four sources in priority order.                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `orchestrateExtensions`          | Run the full extension pipeline against a resolved project config.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts)                        |
| `parseExtensionManifest`         | Parse strict JSON or the hardened JSONC subset used for Deno manifests.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/manifest-reader.ts)                    |
| `parsePackageMetadata`           | Parse veryfront extension metadata from a package.json-like object.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `resolve`                        | Resolve path segments to an absolute path.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts)                          |
| `runtimeInstallTarget`           | Return the client that ships with `runtime`.                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts)                    |
| `tryResolve`                     | Try to resolve.                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts)                          |
| `validateExtension`              | Validate the shape of an extension object. Returns an array of issue descriptions (empty array = valid).                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts)                         |

### Classes

| Name              | Description                 | Source                                                                                   |
| ----------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `ExtensionLoader` | Implement extension loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts) |

### Types

| Name                             | Description                                                                                                        | Source                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Capability`                     | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ConflictInfo`                   | Information about a contract conflict between extensions.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts)                         |
| `CreateSandboxShellToolsInput`   | Input payload for create sandbox shell tools.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts)                |
| `DiscoveredPackageExtension`     | A package extension whose manifest is bound to one physical import target.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `Extension`                      | Public API contract for extension.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ExtensionActivationMode`        | Controls whether installation alone may activate an extension package.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `ExtensionConfigEntry`           | Entry shape for extension config.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ExtensionContext`               | Context for extension.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ExtensionContractMetadata`      | Public API contract for extension contract metadata.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ExtensionFactory`               | Public API contract for extension factory.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ExtensionLogger`                | Public API contract for extension logger.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ExtensionSource`                | Public API contract for extension source.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `ImageOptimizationEngine`        | Image decoder, resizer, and encoder implemented by an explicit extension.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `ImageOptimizationFormat`        | Formats core can request from an image optimization engine.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `ImageOptimizationRequest`       | Immutable byte-oriented request supplied by core.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `ImageOptimizationResult`        | Portable result returned by an image optimization engine.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts)    |
| `InstallTarget`                  | Package client that owns a project's dependencies.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts)                    |
| `OrchestrateOptions`             | Options for `orchestrateExtensions`.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts)                        |
| `PackageMetadata`                | Metadata extracted from a package.json that declares itself as a veryfront extension.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts)                          |
| `RedisRuntimeProvider`           | Optional Redis runtime implementation supplied by an extension.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `ResolvedExtension`              | Public API contract for resolved extension.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts)                              |
| `SandboxShellClient`             | Public API contract for sandbox shell client.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts)                |
| `SandboxShellToolDefinition`     | Definition for sandbox shell tool.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts)                |
| `SandboxShellToolExecute`        | Public API contract for sandbox shell tool execute.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts)                |
| `SandboxShellToolSet`            | Public API contract for sandbox shell tool set.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts)                |
| `SandboxShellToolsProvider`      | Public API contract for sandbox shell tools provider.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts)                |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/extensions/auth`

Auth contracts, including the required generation-owned, fail-closed React Server Action authorization provider.

```ts
import {
  createRscActionAuthorizationProvider,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH,
  snapshotRscActionAuthorizationProvider,
} from "veryfront/extensions/auth";
```

#### Components

| Name                                                 | Description                                                                                   | Source                                                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH` | Maximum length of any one dense argument array: 50,000.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH`        | Maximum nested container depth in the detached authorization argument graph: 64.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES`        | Maximum values in the complete detached authorization argument graph: 50,000.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES`   | Maximum aggregate array elements and record properties in the argument graph: 100,000.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS`      | Cooperative-cancellation grace: 1,000 ms before a non-settling generation is quarantined.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RSC_ACTION_AUTHORIZATION_TIMEOUT_MS`                | Default deadline for one asynchronous authorization decision: 30 seconds.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS`                 | Maximum top-level arguments in one Server Action request: 50.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorizationProviderName`                 | Generation-owned contract name registered by an application-selected authorization extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |

#### Functions

| Name                                     | Description                                                                                                                | Source                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `createRscActionAuthorizationProvider`   | Create immutable provider registration metadata from a standalone authorizer.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `snapshotRscActionAuthorizationProvider` | Capture an exact `{ authorize }` extension registration without invoking accessors or retaining mutable provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |

#### Types

| Name                             | Description                                                                                                                                                                                                                 | Source                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `AuthProvider`                   | AuthProvider contract interface.                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts)                     |
| `RscActionAuthorizationArray`    | Immutable dense data-only array with stable index and iteration semantics.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorizationContext`  | Detached immutable action metadata and bounded JSON-compatible arguments.                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorizationHeaders`  | Immutable null-prototype lowercase header snapshot; it contains no request body.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorizationProvider` | Required generation-owned Server Action authorization contract. An absent, malformed, retiring, failed, or non-cooperative provider returns 503 with `Cache-Control: no-store`; core has no allow-all fallback.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorizationRecord`   | Immutable null-prototype data-only record; absent properties resolve to `undefined`.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorizationRequest`  | Immutable, bodyless request metadata detached from the mutable request object.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorizationValue`    | JSON-compatible, data-only value domain; numbers are always finite.                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `RscActionAuthorize`             | Decide one Server Action invocation. `true` invokes the action and `false` returns 403. Throwing, rejecting, timing out, or returning a non-boolean fails closed with 503; the action is never loaded before authorization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts) |
| `SignOptions`                    | Options for signing a token.                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts)                     |
| `TokenHeader`                    | The parsed, unverified header of a JWT.                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts)                     |
| `TokenPayload`                   | Payload data stored within a signed token.                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts)                     |
| `VerifyOptions`                  | Options for verifying a token.                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts)                     |

### `veryfront/extensions/bundler`

Bundler category barrel - Bundler contract, module lexer, and resolver helper.

```ts
import { build, context, getBundler } from "veryfront/extensions/bundler";
```

#### Functions

| Name                             | Description                                                                                                                                      | Source                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `build`                          | Convenience wrapper: `bundler.bundle(opts)`.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts)            |
| `context`                        | Create an incremental build context (watch/rebuild mode).                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts)            |
| `getBundler`                     | Resolve the registered `Bundler` contract. Throws if no extension provides it.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts)            |
| `readTypeScriptDecoratorOptions` | Resolve the two legacy-decorator flags from a TypeScript configuration.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/typescript-config.ts) |
| `stop`                           | Stop the bundler. Optional - extension teardown will also call this. Provided so tests that previously called `esbuild.stop()` keep working.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts)            |
| `transform`                      | Convenience wrapper that mirrors esbuild's `transform(code, options)` positional signature so call-sites migrating off esbuild keep their shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts)            |

#### Types

| Name                                  | Description                                                                                  | Source                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `BuildContext`                        | Incremental/rebuild context produced by `Bundler.context`.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BuildFailure`                        | Failure thrown by `Bundler.bundle` or `Bundler.transform`.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BuildOptions`                        | Options passed to `Bundler.bundle`.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BuildResult`                         | Result returned from `Bundler.bundle`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BundleOptions`                       | Options passed to `Bundler.bundle`.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BundleOutput`                        | A single output file produced by a bundle operation.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `Bundler`                             | Bundler contract interface.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BundleResult`                        | Result returned from `Bundler.bundle`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BundlerMessage`                      | A diagnostic message (error or warning) from a bundler.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BundlerMessageLocation`              | Location of an error or warning in source.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BundlerPlugin`                       | A bundler plugin that hooks into the build pipeline.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `BundlerPluginBuild`                  | Build context exposed to bundler plugins.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `ImportSpecifier`                     | A single import specifier position record, matching the shape produced by `es-module-lexer`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts)      |
| `Loader`                              | Loader hint for source files. Mirrors esbuild's `Loader` type.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `Message`                             | A diagnostic message (error or warning) from a bundler.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `Metafile`                            | Dependency-graph metadata produced by a bundler when `metafile: true`.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `MetafileInput`                       | Input file entry in a `Metafile`.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `MetafileOutput`                      | Output file entry in a `Metafile`.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `ModuleLexer`                         | Module lexer contract interface.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts)      |
| `OnLoadArgs`                          | Arguments passed to an `onLoad` callback.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `OnLoadResult`                        | Result returned from an `onLoad` callback.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `OnResolveArgs`                       | Arguments passed to an `onResolve` callback.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `OnResolveResult`                     | Result returned from an `onResolve` callback.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `Plugin`                              | A bundler plugin that hooks into the build pipeline.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `PluginBuild`                         | Build context exposed to bundler plugins.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `ReadTypeScriptDecoratorOptionsInput` | Input for `readTypeScriptDecoratorOptions`.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/typescript-config.ts) |
| `ResolveOptions`                      | Options for resolving a module from inside a bundler plugin.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `ResolveResult`                       | Result returned from an `onResolve` callback.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `StdinOptions`                        | In-memory source input for `BundleOptions.stdin`.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `TransformOptions`                    | Options passed to `Bundler.transform`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `TransformResult`                     | Result returned from `Bundler.transform`.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |
| `TypeScriptDecoratorOptions`          | Compiler flags that control legacy TypeScript decorator transformation.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts)           |

### `veryfront/extensions/cache`

Cache category barrel - generic cache and proxy-grade token cache.

```ts
import type { CacheStore, TokenCacheEntry, TokenCacheStats } from "veryfront/extensions/cache";
```

#### Types

| Name              | Description                                         | Source                                                                                                    |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CacheStore`      | CacheStore contract interface.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/cache-store.ts)       |
| `TokenCacheEntry` | A cache entry stored by `TokenCacheStore`.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts) |
| `TokenCacheStats` | Aggregate usage statistics for a `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts) |
| `TokenCacheStore` | TokenCacheStore contract interface.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts) |

### `veryfront/extensions/compat`

Compat category barrel - optional native runtime services.

```ts
import type {
  DocumentExtractionOptions,
  DocumentExtractionProgress,
  DocumentExtractionProgressEvent,
} from "veryfront/extensions/compat";
```

#### Types

| Name                              | Description                                                                                                                        | Source                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DocumentExtractionOptions`       |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |
| `DocumentExtractionProgress`      |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |
| `DocumentExtractionProgressEvent` |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |
| `DocumentExtractor`               | Document extraction contract.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |
| `KreuzbergExtractor`              | Shape returned by the kreuzberg document-extraction module.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |
| `SqliteDatabase`                  | Minimal interface for a SQLite database connection, compatible with `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |
| `SqliteStatement`                 | Minimal interface for a prepared SQLite statement, compatible with `better-sqlite3`'s `Statement` shape.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |
| `SqliteStore`                     | SQLite-backed storage contract.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts) |

### `veryfront/extensions/content`

Content category barrel for the MDX/Markdown content processor contract.

```ts
import type {
  CompilationMode,
  CompilationTarget,
  ContentCompileOptions,
} from "veryfront/extensions/content";
```

#### Types

| Name                      | Description                                                                                                                                                                                                                     | Source                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CompilationMode`         | Compilation mode. Dev surfaces extra diagnostics.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts) |
| `CompilationTarget`       | Where the output is destined: server-side RSC or browser bundle.                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts) |
| `ContentCompileOptions`   | Options for `ContentProcessor.compileMdx` and `ContentProcessor.compileMarkdown`.                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts) |
| `ContentPlugin`           | Opaque unified-compatible plugin entry. Kept as an unknown-typed value or tuple so the contract surface doesn't require consumers to depend on the `unified` package directly. Callers cast to the plugin-list shape they need. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts) |
| `ContentProcessingResult` | Processing result returned by the content pipeline.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts) |
| `ContentProcessor`        | ContentProcessor contract for MDX/Markdown processing.                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts) |

### `veryfront/extensions/contracts`

Contract registry - runtime resolution of extension-provided implementations.

```ts
import { register, reset, resolve } from "veryfront/extensions/contracts";
```

#### Functions

| Name         | Description                                | Source                                                                                      |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `register`   | Register.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts) |
| `reset`      | Reset.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts) |
| `resolve`    | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts) |
| `tryResolve` | Try to resolve.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts) |
| `unregister` | Unregister.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts) |

### `veryfront/extensions/css`

CSS category barrel - CSS compilation and optimization contracts.

```ts
import {
  assertCSSOptimizationEngine,
  assertCSSProcessor,
  assertCSSPurgingEngine,
} from "veryfront/extensions/css";
```

#### Components

| Name                                              | Description                                                                  | Source                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CSSOptimizationEngineName`                       | Registry name used for the CSS optimization extension contract.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts) |
| `CSSProcessorName`                                | Registry name used for the CSS compiler extension contract.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `CSSPurgingEngineName`                            |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |
| `MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the runtime boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts) |
| `MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS` |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS`           |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS`      |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |

#### Functions

| Name                           | Description                                                                                                                                     | Source                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `assertCSSOptimizationEngine`  | Validate an implementation received through the dynamic contract registry.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts) |
| `assertCSSProcessor`           | Validate an implementation received through the dynamic extension registry.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `assertCSSPurgingEngine`       |                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |
| `captureCSSCompiler`           | Capture a compiler method once so accessors and later mutation cannot redirect a build.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `captureCSSOptimizationEngine` | Capture dynamic properties once so later mutation or accessors cannot change the implementation that core invokes.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts) |
| `captureCSSProcessor`          | Capture the complete processor surface once. A registry or implementation mutation can therefore affect only a subsequently acquired operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `captureCSSPurgingEngine`      | Capture identity and method once so registry mutation cannot split a run.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |

#### Types

| Name                     | Description                                            | Source                                                                                                        |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `CSSCompiler`            | Stateful compiler returned by `CSSProcessor.compile`.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `CSSOptimizationEngine`  | Parser-backed CSS optimization contract.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts) |
| `CSSOptimizationRequest` | Immutable optimization request supplied by core.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts) |
| `CSSOptimizationResult`  | Portable output returned by a CSS optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts) |
| `CSSProcessor`           | CSSProcessor contract interface.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts)           |
| `CSSPurgeContentSource`  |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |
| `CSSPurgingEngine`       |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |
| `CSSPurgingRequest`      |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |
| `CSSPurgingResult`       |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts)      |

### `veryfront/extensions/database`

Database category barrel - DatabaseClient contract.

```ts
import type { DatabaseClient, QueryResult } from "veryfront/extensions/database";
```

#### Types

| Name             | Description                                  | Source                                                                                                     |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DatabaseClient` | DatabaseClient contract interface.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts) |
| `QueryResult`    | Result returned from `DatabaseClient.query`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts) |

### `veryfront/extensions/dev-ui`

Contracts and protocol constants for extension-owned local development UIs.

```ts
import {
  createDevUiAssetProvider,
  getDashboardSessionCookieName,
  snapshotDevUiAssetProvider,
} from "veryfront/extensions/dev-ui";
```

#### Components

| Name                           | Description                                                              | Source                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `DASHBOARD_CSRF_COOKIE_NAME`   | Stable prefix for port-scoped privileged dashboard session cookies.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |
| `DASHBOARD_CSRF_HEADER_NAME`   | Shared request header carrying the shell's session-bound CSRF token.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |
| `DASHBOARD_CSRF_META_NAME`     | Shared metadata name used to pass the CSRF token into the extension UI.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |
| `DASHBOARD_SESSION_PATH`       | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |
| `DEV_UI_KIND_ATTRIBUTE`        | Stable shell identity consumed by the extension-owned shared bundle.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |
| `DevUiAssetProviderName`       |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts) |
| `MAX_DEV_UI_BUNDLE_BYTES`      |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts) |

#### Functions

| Name                            | Description                                                               | Source                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `createDevUiAssetProvider`      |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts) |
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |
| `snapshotDevUiAssetProvider`    |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts) |
| `validateDevUiBundle`           |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts) |

#### Types

| Name                 | Description                                                                       | Source                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DevUiAssetProvider` | One self-contained browser bundle mounts dashboard or projects by shell identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts) |
| `DevUiKind`          |                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts)              |

### `veryfront/extensions/dev-ui/protocol`

Stable prefix for port-scoped privileged dashboard session cookies.

```ts
import {
  DASHBOARD_CSRF_COOKIE_NAME,
  DASHBOARD_CSRF_HEADER_NAME,
  getDashboardSessionCookieName,
} from "veryfront/extensions/dev-ui/protocol";
```

#### Components

| Name                           | Description                                                              | Source                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `DASHBOARD_CSRF_COOKIE_NAME`   | Stable prefix for port-scoped privileged dashboard session cookies.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |
| `DASHBOARD_CSRF_HEADER_NAME`   | Shared request header carrying the shell's session-bound CSRF token.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |
| `DASHBOARD_CSRF_META_NAME`     | Shared metadata name used to pass the CSRF token into the extension UI.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |
| `DASHBOARD_SESSION_PATH`       | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |
| `DEV_UI_KIND_ATTRIBUTE`        | Stable shell identity consumed by the extension-owned shared bundle.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |

#### Functions

| Name                            | Description                                                               | Source                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |

#### Types

| Name        | Description | Source                                                                                            |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `DevUiKind` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts) |

### `veryfront/extensions/distributed`

Provider-neutral contracts for optional distributed runtime infrastructure.

```ts
import {
  captureRedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "veryfront/extensions/distributed";
```

#### Components

| Name                       | Description                                        | Source                                                                                                               |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `RedisRuntimeProviderName` | Registry name used by the Redis runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |

#### Functions

| Name                          | Description                                                                                                                                           | Source                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `captureRedisRuntimeProvider` | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |

#### Types

| Name                                | Description                                                         | Source                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NodeRedisClient`                   | Structural node-redis client surface used by the platform adapter.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `NodeRedisModule`                   | Structural module surface used by the platform Redis adapter.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `RedisClient`                       | Structural client surface used by core cache features.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `RedisClientHandle`                 | Independently owned Redis connection returned to a core feature.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `RedisClientOptions`                | Connection options accepted by the stable core Redis client facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `RedisEventPublisherConfig`         | Redis Pub/Sub publisher configuration.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `RedisEventPublisherImplementation` | Redis-backed event publisher/subscriber implementation.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `RedisRuntimeProvider`              | Optional Redis runtime implementation supplied by an extension.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |

### `veryfront/extensions/distributed/agent-memory-support`

Provider-neutral agent-memory contracts shared with memory extensions.

```ts
import { estimateTokens } from "veryfront/extensions/distributed/agent-memory-support";
```

#### Functions

| Name             | Description | Source                                                                                               |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `estimateTokens` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts) |

#### Types

| Name               | Description                               | Source                                                                                               |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Memory`           | Public API contract for memory.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts) |
| `MemoryConfigBase` | ************************ Memory Interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts) |
| `MemoryStats`      | Public API contract for memory stats.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts) |
| `MinimalMessage`   |                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts) |

### `veryfront/extensions/distributed/cache-support`

Provider-neutral cache helpers shared with distributed store extensions.

```ts
import {
  assertCacheBatchSize,
  assertCacheReadMaximumBytes,
  assertCacheValueWithinLimit,
} from "veryfront/extensions/distributed/cache-support";
```

#### Components

| Name                                     | Description                                                            | Source                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DEFAULT_CACHE_TTL_SECONDS`              | Shared default used when a CacheBackend caller omits a TTL.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts) |
| `MAX_CACHE_REVISION_LENGTH`              | Maximum number of code units in a cache revision identifier.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts)        |
| `MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH` | Maximum source-key length before the reserved namespace is added.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts) |
| `REVISIONED_CACHE_KEY_PREFIX`            | Reserved logical-key namespace for revisioned Veryfront cache entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts) |

#### Functions

| Name                                      | Description                                                                                                                                                                                                             | Source                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `assertCacheBatchSize`                    | Enforce the cache subsystem's shared per-operation batch bound.                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-policy.ts)                  |
| `assertCacheReadMaximumBytes`             | Validate one caller-supplied cache payload byte ceiling.                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts)                  |
| `assertCacheValueWithinLimit`             | Verify a string payload without allocating an encoded copy.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts)                  |
| `buildBatchResults`                       | Build a `Map` of batch results by resolving each key in order.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-results.ts)                 |
| `buildRevisionedCacheKey`                 | Add the reserved versioned namespace to one valid source key.                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts)                  |
| `escapeCacheGlobLiteral`                  | Escape the wildcard syntax shared by cache backend pattern operations.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts) |
| `expiresImmediately`                      |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts)                  |
| `isRevisionedCacheBackend`                | Test whether a backend exposes the complete atomic revision capability.                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts)                  |
| `isRevisionedCacheKey`                    | Test whether a key belongs to the valid revisioned-key builder image.                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts)                  |
| `parseSerializedCachePayload`             | Reject oversized or malformed JSON before constructing an untrusted object graph.                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts)       |
| `registerOwnedDistributedCacheKeyPrefix`  | Register an opaque namespace without making it eligible for project invalidation.                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts) |
| `registerRenderDistributedCacheNamespace` | Register a namespace containing render-cache keys.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts) |
| `requireCacheExchangeResult`              | Validate a provider-returned compare-exchange result.                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts)                  |
| `requirePositiveIntegerCacheTtlSeconds`   | Validate a constructor-level TTL for whole-second cache protocols.                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts)                  |
| `resolveIntegerCacheTtlSeconds`           | Resolve a TTL for protocols that accept only whole seconds. Positive fractions round up so integer conversion never expires an entry earlier than requested; non-positive values retain their immediate-expiry meaning. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts)                  |
| `serializeCachePayload`                   | Serialize using the origin-compatible payload shape.                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts)       |
| `snapshotCacheRevisionResult`             | Validate and detach a provider-returned revision snapshot.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts)                  |
| `stripOwnedDistributedCacheKeyPrefix`     |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts) |
| `validateDistributedCacheKeyPrefix`       |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts) |

#### Classes

| Name                      | Description                                              | Source                                                                                    |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `CacheValueTooLargeError` | Deterministic overflow from an exact bounded cache read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts) |

#### Types

| Name                             | Description                                                                                                                                   | Source                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CacheBackend`                   | Provides storage operations for memory, disk, API, and extension-backed distributed caches. All cache backends must implement this interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts)                          |
| `CachePayload`                   |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts)                |
| `CacheReadOptions`               | Options for a single logical backend read.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts)                          |
| `CacheRevisionMutation`          | Atomic mutation applied when an expected cache revision still matches.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts)                          |
| `CacheRevisionSnapshot`          | Serialized logical value and the revision that observed it.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts)                          |
| `CacheStoreStats`                |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts)                |
| `DistributedCacheAdministration` | Narrow administrative surface used by cache diagnostics and invalidation.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts) |
| `DistributedCacheKeyListing`     | Immutable bounded cache listing with explicit completeness.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts) |
| `DistributedCacheListOptions`    | Bounded provider-neutral cache listing request.                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts) |
| `RenderCacheStore`               |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts)                |
| `ResolvedCacheAuthority`         | The credential and project reference a cache backend read is made under.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/request-authority.ts)              |
| `RevisionedCacheBackend`         | Cache backend with the complete atomic revision capability.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts)                          |

### `veryfront/extensions/distributed/rate-limit-support`

Provider-neutral rate-limit helpers shared with store extensions.

```ts
import {
  requireRateLimitKey,
  requireRateLimitWindowMs,
  unrefTimer,
} from "veryfront/extensions/distributed/rate-limit-support";
```

#### Components

| Name                                         | Description                                                               | Source                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `MAX_RATE_LIMIT_KEY_LENGTH`                  | Maximum UTF-16 code units accepted by a rate-limit key.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts)   |
| `MAX_TIMER_DELAY_MS`                         | Largest delay supported consistently by JavaScript timer implementations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/limits.ts)                              |
| `REDIS_RATE_LIMIT_INCREMENT_WITH_TTL_SCRIPT` | Atomic Redis script that increments a counter and assigns its TTL.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit-script.ts) |

#### Functions

| Name                       | Description                                                      | Source                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `requireRateLimitKey`      |                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts) |
| `requireRateLimitWindowMs` |                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts) |
| `unrefTimer`               | Unreference a timer to prevent it from keeping the process alive | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)                 |

#### Types

| Name             | Description                               | Source                                                                                                   |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `RateLimitEntry` |                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts) |
| `RateLimitStore` | Public API contract for rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts) |

### `veryfront/extensions/distributed/routing-invalidation-support`

Provider-neutral routing-invalidation primitives shared with extensions.

```ts
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
  parseProxyRoutingInvalidationEvent,
} from "veryfront/extensions/distributed/routing-invalidation-support";
```

#### Functions

| Name                                  | Description                                                | Source                                                                                            |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `hasProjectIdentityControlCharacters` | Whether a string contains a Unicode Cc control code point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts)     |
| `isCanonicalOpaqueProjectIdentifier`  | Whether a value is a bounded, exact opaque identifier.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts)     |
| `parseProxyRoutingInvalidationEvent`  |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts) |

#### Types

| Name                                    | Description | Source                                                                                            |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `ProxyRoutingInvalidationEvent`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts) |
| `ProxyRoutingInvalidationPublisher`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts) |
| `ProxyRoutingInvalidationPublishResult` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts) |

### `veryfront/extensions/eval`

Eval category barrel: eval report exporter contracts.

```ts
import {
  createEvalReportExporterRegistry,
  EvalReportExporterRegistryName,
  redactEvalReportForExport,
} from "veryfront/extensions/eval";
```

#### Components

| Name                             | Description                                                               | Source                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `EvalReportExporterRegistryName` | Contract name used for `resolve()` / `provide()`.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportRedactedValue`        | Sentinel used when record payload fields are removed for external export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |

#### Functions

| Name                               | Description                                                        | Source                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `createEvalReportExporterRegistry` | Create an eval report exporter registry.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `redactEvalReportForExport`        | Create an eval report copy with external-export redaction applied. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |

#### Types

| Name                           | Description                                                                 | Source                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `EvalReportExportContext`      | Context passed to eval report exporters.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportExporter`           | Vendor or backend implementation that receives sanitized eval reports.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportExporterRegistry`   | Registry contract. Single impl created at bootstrap.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportExportFailure`      | Failed exporter result. Failures are captured so later exporters still run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportExportReceipt`      | Optional receipt returned by a vendor exporter.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportExportRedaction`    | Redaction policy applied before reports leave the process.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/eval/types.ts)                           |
| `EvalReportExportResult`       | Result for one exporter invocation.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportExportSuccess`      | Successful exporter result.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |
| `EvalReportExportTraceContext` | Trace correlation fields that connect eval exports to runtime spans.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts) |

### `veryfront/extensions/first-party-import`

Resolve first-party extension implementations without making the root npm package statically depend on every extension dependency. Source and compiled-binary builds can load the workspace extension sources. npm builds should load the separate @veryfront/ext-* packages installed by the consuming service or app.

```ts
import {
  firstPartyExtensionSourceSpecifiers,
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "veryfront/extensions/first-party-import";
```

#### Functions

| Name                                  | Description                                                                                                                                          | Source                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `firstPartyExtensionSourceSpecifiers` |                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts) |
| `importFirstPartyExtensionModule`     |                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts) |
| `isMissingFirstPartyExtensionModule`  | Classify a dynamic-import failure as "the extension module itself is not installed" as opposed to a real load failure inside an installed extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts) |

#### Types

| Name                               | Description                                                       | Source                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `FirstPartyExtensionImportOptions` | Optional non-root entry point for a first-party extension import. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts) |

### `veryfront/extensions/image`

Image extension contracts.

```ts
import {
  assertImageOptimizationEngine,
  captureImageOptimizationEngine,
  ImageOptimizationEngineName,
} from "veryfront/extensions/image";
```

#### Components

| Name                                                | Description                                                          | Source                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ImageOptimizationEngineName`                       | Registry name used for the image optimization extension contract.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |

#### Functions

| Name                             | Description                                                                | Source                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `assertImageOptimizationEngine`  | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |

#### Types

| Name                             | Description                                                               | Source                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ImageOptimizationEngine`        | Image decoder, resizer, and encoder implemented by an explicit extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |
| `ImageOptimizationFormat`        | Formats core can request from an image optimization engine.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |
| `ImageOptimizationRequest`       | Immutable byte-oriented request supplied by core.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |
| `ImageOptimizationResult`        | Portable result returned by an image optimization engine.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts) |

### `veryfront/extensions/llm`

LLM category barrel - provider, embedding, and registry contracts. Interfaces re-exported with `export type { ... }` because Deno `--no-check` transpiles each file in isolation and would otherwise emit a runtime value re-export that fails ESM resolution. Reserve plain `export { ... }` for runtime values.

```ts
import { createLLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";
```

#### Components

| Name                      | Description                                       | Source                                                                                             |
| ------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `LLMProviderRegistryName` | Contract name used for `resolve()` / `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts) |

#### Functions

| Name                        | Description                  | Source                                                                                                      |
| --------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `createLLMProviderRegistry` | Create llmprovider registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider-registry.ts) |

#### Types

| Name                  | Description                                                                                                                                                                                                                                      | Source                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `EmbeddingOptions`    | Options passed to `EmbeddingProvider.embed`.                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts) |
| `EmbeddingProvider`   | EmbeddingProvider contract interface.                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts) |
| `EmbeddingResult`     | Result returned from `EmbeddingProvider.embed`.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts) |
| `LLMProvider`         | An LLM provider implementation. Extensions register one of these with the `LLMProviderRegistry` during setup(). `createModel` is required; `createEmbedding` and `createResponses` are optional and absent on providers that don't support them. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts)       |
| `LLMProviderConfig`   | Config passed to any provider's create* method.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts)       |
| `LLMProviderRegistry` | Registry contract. Single impl created at bootstrap.                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts)       |

### `veryfront/extensions/observability`

Observability category barrel: tracing and Node telemetry contracts.

```ts
import {
  ApplicationErrorReporterInitializerName,
  NodeTelemetryProviderName,
} from "veryfront/extensions/observability";
```

#### Components

| Name                                      | Description                                                                    | Source                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `ApplicationErrorReporterInitializerName` | Contract name used when an application composes a reporter through extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `NodeTelemetryProviderName`               | Contract interface for Node.js OpenTelemetry runtime bootstrap.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |

#### Types

| Name                                            | Description                                                                                                               | Source                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ApplicationErrorContext`                       | Sanitized context attached when a runtime reports an application error.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts)            |
| `ApplicationErrorReporter`                      | Provider-neutral application error capture and flush interface.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts)            |
| `ApplicationErrorReporterInitializationContext` | Runtime context passed to an explicitly selected reporter initializer.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `ApplicationErrorReporterInitializer`           | Application-composition contract for an error-reporting implementation.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `ApplicationErrorReporterSession`               | Reporter and cleanup ownership returned by an application-selected initializer.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts) |
| `NodeTelemetryInitializeOptions`                | Options accepted by node telemetry initialize.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |
| `NodeTelemetryInstrumentationConfig`            | Configuration used by node telemetry instrumentation.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |
| `NodeTelemetryLogger`                           | Public API contract for node telemetry logger.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |
| `NodeTelemetryLogRecord`                        | Structured log record shape accepted by the telemetry provider.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |
| `NodeTelemetryLogRecordEmitter`                 | Emits a structured logger record into the active telemetry pipeline.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |
| `NodeTelemetryProcessTarget`                    | Public API contract for node telemetry process target.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |
| `NodeTelemetryProvider`                         | Initializes Node-specific OpenTelemetry SDK behavior.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts)    |
| `SpanData`                                      | Data describing a single trace span.                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts)           |
| `TracerProvider`                                | Minimal TracerProvider interface for the contract. Structurally compatible with both the core shim and the real OTel SDK. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts)           |
| `TracingExporter`                               | TracingExporter contract interface.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts)           |

### `veryfront/extensions/parser`

Parser category barrel: CodeParser (AST traversal), SkillDocumentParser (Skill frontmatter decoding), and YamlParser (general YAML decoding) contracts.

```ts
import {
  createSkillDocumentParserProvider,
  createYamlParserProvider,
  snapshotSkillDocumentParserProvider,
} from "veryfront/extensions/parser";
```

#### Components

| Name                              | Description                                                       | Source                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SkillDocumentParserProviderName` | Stable runtime identifier for the Skill document parser contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts) |
| `YamlParserProviderName`          | Stable runtime identifier for the general YAML parser contract.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts)           |

#### Functions

| Name                                  | Description                                                                                                                                       | Source                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `createSkillDocumentParserProvider`   | Create immutable provider registration metadata from a standalone parser.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts) |
| `createYamlParserProvider`            | Create immutable provider registration metadata from a standalone parser.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts)           |
| `snapshotSkillDocumentParserProvider` | Capture one immutable provider generation without retaining its mutable registration object or invoking extension-owned accessors or Proxy traps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts) |
| `snapshotYamlParserProvider`          | Capture one immutable provider generation.                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts)           |

#### Types

| Name                            | Description                                                                                                                                         | Source                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ASTNode`                       | A single node in an abstract syntax tree.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `CodeParser`                    | Public API contract for code parser.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `FunctionDirectiveOptions`      | Options for a parser-owned function directive check.                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `GenerateOptions`               | Options passed to `CodeParser.generate`.                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `GenerateResult`                | Result returned from `CodeParser.generate`.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `InjectJsxNodePositionsOptions` | Options for `CodeParser.injectJsxNodePositions`.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `NodePath`                      | Wrapper providing traversal context for a visited node.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `ParseOptions`                  | Options passed to `CodeParser.parse`.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `SkillDocumentParserProvider`   | Dependency-free contract implemented by Skill YAML parser extensions.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts) |
| `TraverseVisitor`               | Visitor callbacks keyed by node type.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts)           |
| `YamlParseOptions`              | Decoding options, named after the `@std/yaml` options the framework's call sites already pass so that repointing a call site is a specifier change. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts)           |
| `YamlParserProvider`            | Dependency-free contract implemented by YAML parser extensions.                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts)           |

### `veryfront/extensions/rendering`

Contracts for extension-owned rendering implementations.

```ts
import {
  createIsolatedSsrRendererProvider,
  snapshotIsolatedSsrRendererProvider,
  validateIsolatedSsrRendererModuleUrl,
} from "veryfront/extensions/rendering";
```

#### Components

| Name                                       | Description | Source                                                                                                            |
| ------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `IsolatedSsrRendererProviderName`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |
| `MAX_ISOLATED_SSR_RENDERER_READ_ROOTS`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |
| `MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |

#### Functions

| Name                                   | Description                                                                                             | Source                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `createIsolatedSsrRendererProvider`    | Create immutable registration metadata for an extension factory.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |
| `snapshotIsolatedSsrRendererProvider`  | Snapshot an extension-owned provider without invoking accessors or retaining mutable provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |
| `validateIsolatedSsrRendererModuleUrl` | Validate one worker renderer module URL without resolving or importing it.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |

#### Types

| Name                          | Description | Source                                                                                                            |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `IsolatedSsrRenderer`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |
| `IsolatedSsrRendererModule`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |
| `IsolatedSsrRendererProvider` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts) |

### `veryfront/extensions/sandbox`

Sandbox category barrel.

```ts
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
```

#### Components

| Name                            | Description                               | Source                                                                                                |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |

#### Types

| Name                           | Description                                           | Source                                                                                                |
| ------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `SandboxShellClient`           | Public API contract for sandbox shell client.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `SandboxShellToolDefinition`   | Definition for sandbox shell tool.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `SandboxShellToolExecute`      | Public API contract for sandbox shell tool execute.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `SandboxShellToolSet`          | Public API contract for sandbox shell tool set.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `SandboxShellToolsProvider`    | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |

### `veryfront/extensions/schema`

Schema category barrel - SchemaValidator contract and inference helpers.

```ts
import type { InferInput, InferSchema, InferShape } from "veryfront/extensions/schema";
```

#### Types

| Name                           | Description                                                                                                                                   | Source                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `InferInput`                   | Extracts the inferred _input_ type from a `Schema<T>`.                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `InferSchema`                  | Extracts the inferred output type `T` from a `Schema<T>`.                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `InferShape`                   | Maps a raw object shape to its inferred object type, preserving optionality.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `JsonSchema`                   |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts)      |
| `JsonSchemaValidationFailure`  | Failed validation of an input against a compiled JSON Schema.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `JsonSchemaValidationFunction` | Compiled, reusable JSON Schema validation function.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `JsonSchemaValidationIssue`    | Stable validation issue copied from a JSON Schema validator result.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `JsonSchemaValidationResult`   | Result returned by a compiled JSON Schema validator.                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `JsonSchemaValidationSuccess`  | Successful validation of an input against a compiled JSON Schema.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `RefinementCtx`                | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `Schema`                       | An opaque schema definition that validates and infers type `T`.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `SchemaFactory`                | Factory type accepted by `defineSchema`.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `SchemaValidator`              | SchemaValidator contract interface.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `SchemaValidatorCoerce`        | Namespace for `coerce.*` constructors - accepts input in any form and coerces to the target type before validation.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `ValidationFailure`            | Failed validation outcome.                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `ValidationIssue`              | A single validation issue with location context.                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `ValidationResult`             | Discriminated union of validation outcomes.                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |
| `ValidationSuccess`            | Successful validation outcome.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts) |

### `veryfront/extensions/types`

Core types for the veryfront extension system.

```ts
import type { Capability, Extension, ExtensionConfigEntry } from "veryfront/extensions/types";
```

#### Types

| Name                        | Description                                                                                                        | Source                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `Capability`                | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `Extension`                 | Public API contract for extension.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `ExtensionConfigEntry`      | Entry shape for extension config.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `ExtensionContext`          | Context for extension.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `ExtensionContractMetadata` | Public API contract for extension contract metadata.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `ExtensionFactory`          | Public API contract for extension factory.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `ExtensionLogger`           | Public API contract for extension logger.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `ExtensionSource`           | Public API contract for extension source.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `PackageContractMetadata`   |                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |
| `ResolvedExtension`         | Public API contract for resolved extension.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts) |

### `veryfront/extensions/websocket`

Contracts for extension-owned Node.js WebSocket implementations.

```ts
import {
  captureNodeWebSocketServer,
  createNodeWebSocketServerProvider,
  snapshotNodeWebSocketServerProvider,
} from "veryfront/extensions/websocket";
```

#### Components

| Name                                             | Description | Source                                                                                                                     |
| ------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `NodeWebSocketServerProviderName`                |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |

#### Functions

| Name                                  | Description                                                                                                                                                                                                    | Source                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `captureNodeWebSocketServer`          | Capture one server instance without retaining mutable method lookups. The underlying implementation remains the receiver because protocol engines legitimately keep mutable transport state on their instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `createNodeWebSocketServerProvider`   | Create immutable registration metadata from a standalone factory.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `snapshotNodeWebSocketServerProvider` | Capture a provider generation without retaining its mutable registration object or invoking extension-owned accessors.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |

#### Types

| Name                          | Description                                                             | Source                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `NodeWebSocketConnection`     | Minimal connection surface consumed by core's runtime-neutral adapter.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `NodeWebSocketMessageData`    |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `NodeWebSocketServer`         | Minimal server surface used by upgrade and shutdown ownership.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `NodeWebSocketServerOptions`  | Exact no-server options supplied by core for an existing HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
| `NodeWebSocketServerProvider` |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts) |
