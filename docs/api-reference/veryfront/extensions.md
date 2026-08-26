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

| Name                                                | Description                                                          | Source                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `CIRCULAR_DEPENDENCY_ERROR`                         | Shared circular dependency error value.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L28)                             |
| `EXTENSION_CONFLICT_ERROR`                          | Shared extension conflict error value.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L37)                             |
| `EXTENSION_VALIDATION_ERROR`                        | Shared extension validation error value.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L19)                             |
| `ImageOptimizationEngineName`                       | Registry name used for the image optimization extension contract.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L22)    |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L25)    |
| `MISSING_EXTENSION_ERROR`                           | Shared missing extension error value.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L10)                             |
| `RedisRuntimeProviderName`                          | Registry name used by the Redis runtime extension.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L18) |
| `SandboxShellToolsProviderName`                     | Render sandbox shell tools provider name.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L5)                 |

### Functions

| Name                             | Description                                                                                                                                                                                                                      | Source                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `assertImageOptimizationEngine`  | Validate an implementation received through the dynamic contract registry.                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L137)    |
| `assertSystemReadCapability`     | Validate the bounded scope required by a `system:read` capability.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L781)                       |
| `auditCapabilities`              | Log capabilities for a named extension at startup.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L842)                       |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations.                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L144)    |
| `captureRedisRuntimeProvider`    | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L502) |
| `composeAbortSignals`            | Compose cancellation sources without depending on a mutable host `AbortSignal.any` implementation. The first source to abort owns the exact propagated reason, and listeners on every remaining source are detached immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/abort-signal.ts#L7)                         |
| `detectConflicts`                | Detect contract conflicts between resolved extensions.                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L515)                         |
| `detectProjectInstallTarget`     | Return the client the project at `projectDirectory` installs with, or `undefined` when no manifest is readable (a hosted render, a directory without read permission, a runtime with no synchronous filesystem).                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts#L81)                     |
| `discoverLocalExtensions`        | Find `*.extension.ts` files in the project root.                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L543)                          |
| `discoverPackageExtensions`      | Discover auto-activated package extensions without exposing identity internals.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L396)                          |
| `discoverProjectExtensions`      | Discover project extension paths without exposing identity internals.                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L530)                          |
| `formatCapabilities`             | Format capabilities as human-readable strings for logging.                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L36)                        |
| `formatInstallCommand`           | Return the command that installs `packageName` with `target`.                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts#L140)                    |
| `getRecommendation`              | Return recommendation.                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/recommendations.ts#L38)                     |
| `isSupportedDenoSystemReadApi`   |                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L110)                       |
| `loadExtensionFactory`           | Dynamically import an extension factory from `path` and resolve it.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/factory-loader.ts#L100)                     |
| `mapToDenoPermissions`           | Map capabilities to Deno CLI permission flags.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L795)                       |
| `mergeExtensions`                | Merge extensions from all four sources in priority order.                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L225)                          |
| `orchestrateExtensions`          | Run the full extension pipeline against a resolved project config.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L176)                        |
| `parseExtensionManifest`         | Parse strict JSON or the hardened JSONC subset used for Deno manifests.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/manifest-reader.ts#L687)                    |
| `parsePackageMetadata`           | Parse veryfront extension metadata from a package.json-like object.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L185)                          |
| `resolve`                        | Resolve path segments to an absolute path.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L18)                           |
| `runtimeInstallTarget`           | Return the client that ships with `runtime`.                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts#L125)                    |
| `tryResolve`                     | Try to resolve.                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L34)                           |
| `validateExtension`              | Validate the shape of an extension object. Returns an array of issue descriptions (empty array = valid).                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L354)                         |

### Classes

| Name              | Description                 | Source                                                                                        |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `ExtensionLoader` | Implement extension loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts#L214) |

### Types

| Name                             | Description                                                                                                        | Source                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `Capability`                     | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L11)                               |
| `ConflictInfo`                   | Information about a contract conflict between extensions.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L30)                          |
| `CreateSandboxShellToolsInput`   | Input payload for create sandbox shell tools.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L38)                 |
| `DiscoveredPackageExtension`     | A package extension whose manifest is bound to one physical import target.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L42)                           |
| `Extension`                      | Public API contract for extension.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L50)                               |
| `ExtensionActivationMode`        | Controls whether installation alone may activate an extension package.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L39)                           |
| `ExtensionConfigEntry`           | Entry shape for extension config.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L65)                               |
| `ExtensionContext`               | Context for extension.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L27)                               |
| `ExtensionContractMetadata`      | Public API contract for extension contract metadata.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L17)                               |
| `ExtensionFactory`               | Public API contract for extension factory.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L62)                               |
| `ExtensionLogger`                | Public API contract for extension logger.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L42)                               |
| `ExtensionSource`                | Public API contract for extension source.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L70)                               |
| `ImageOptimizationEngine`        | Image decoder, resizer, and encoder implemented by an explicit extension.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L71)     |
| `ImageOptimizationFormat`        | Formats core can request from an image optimization engine.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L29)     |
| `ImageOptimizationRequest`       | Immutable byte-oriented request supplied by core.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L32)     |
| `ImageOptimizationResult`        | Portable result returned by an image optimization engine.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L56)     |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L48)     |
| `InstallTarget`                  | Package client that owns a project's dependencies.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/install-command.ts#L52)                     |
| `OrchestrateOptions`             | Options for `orchestrateExtensions`.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L32)                         |
| `PackageMetadata`                | Metadata extracted from a package.json that declares itself as a veryfront extension.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L27)                           |
| `RedisRuntimeProvider`           | Optional Redis runtime implementation supplied by an extension.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L161) |
| `ResolvedExtension`              | Public API contract for resolved extension.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L78)                               |
| `SandboxShellClient`             | Public API contract for sandbox shell client.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L30)                 |
| `SandboxShellToolDefinition`     | Definition for sandbox shell tool.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L13)                 |
| `SandboxShellToolExecute`        | Public API contract for sandbox shell tool execute.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L8)                  |
| `SandboxShellToolSet`            | Public API contract for sandbox shell tool set.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L27)                 |
| `SandboxShellToolsProvider`      | Public API contract for sandbox shell tools provider.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L47)                 |

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

| Name                                                 | Description                                                                                   | Source                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH` | Maximum length of any one dense argument array: 50,000.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L51) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH`        | Maximum nested container depth in the detached authorization argument graph: 64.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L42) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES`        | Maximum values in the complete detached authorization argument graph: 50,000.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L45) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES`   | Maximum aggregate array elements and record properties in the argument graph: 100,000.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L48) |
| `RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS`      | Cooperative-cancellation grace: 1,000 ms before a non-settling generation is quarantined.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L36) |
| `RSC_ACTION_AUTHORIZATION_TIMEOUT_MS`                | Default deadline for one asynchronous authorization decision: 30 seconds.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L33) |
| `RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS`                 | Maximum top-level arguments in one Server Action request: 50.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L39) |
| `RscActionAuthorizationProviderName`                 | Generation-owned contract name registered by an application-selected authorization extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L30) |

#### Functions

| Name                                     | Description                                                                                                                | Source                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `createRscActionAuthorizationProvider`   | Create immutable provider registration metadata from a standalone authorizer.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L192) |
| `snapshotRscActionAuthorizationProvider` | Capture an exact `{ authorize }` extension registration without invoking accessors or retaining mutable provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L142) |

#### Types

| Name                             | Description                                                                                                                                                                                                                 | Source                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `AuthProvider`                   | AuthProvider contract interface.                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L60)                      |
| `RscActionAuthorizationArray`    | Immutable dense data-only array with stable index and iteration semantics.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L63)  |
| `RscActionAuthorizationContext`  | Detached immutable action metadata and bounded JSON-compatible arguments.                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L74)  |
| `RscActionAuthorizationHeaders`  | Immutable null-prototype lowercase header snapshot; it contains no request body.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L87)  |
| `RscActionAuthorizationProvider` | Required generation-owned Server Action authorization contract. An absent, malformed, retiring, failed, or non-cooperative provider returns 503 with `Cache-Control: no-store`; core has no allow-all fallback.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L123) |
| `RscActionAuthorizationRecord`   | Immutable null-prototype data-only record; absent properties resolve to `undefined`.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L69)  |
| `RscActionAuthorizationRequest`  | Immutable, bodyless request metadata detached from the mutable request object.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L93)  |
| `RscActionAuthorizationValue`    | JSON-compatible, data-only value domain; numbers are always finite.                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L54)  |
| `RscActionAuthorize`             | Decide one Server Action invocation. `true` invokes the action and `false` returns 403. Throwing, rejecting, timing out, or returning a non-boolean fails closed with 503; the action is never loaded before authorization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L113) |
| `SignOptions`                    | Options for signing a token.                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L22)                      |
| `TokenHeader`                    | The parsed, unverified header of a JWT.                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L46)                      |
| `TokenPayload`                   | Payload data stored within a signed token.                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L10)                      |
| `VerifyOptions`                  | Options for verifying a token.                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L32)                      |

### `veryfront/extensions/bundler`

Bundler category barrel - Bundler contract, module lexer, and resolver helper.

```ts
import { build, context, getBundler } from "veryfront/extensions/bundler";
```

#### Functions

| Name                             | Description                                                                                                                                      | Source                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `build`                          | Convenience wrapper: `bundler.bundle(opts)`.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L27)             |
| `context`                        | Create an incremental build context (watch/rebuild mode).                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L52)             |
| `getBundler`                     | Resolve the registered `Bundler` contract. Throws if no extension provides it.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L22)             |
| `readTypeScriptDecoratorOptions` | Resolve the two legacy-decorator flags from a TypeScript configuration.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/typescript-config.ts#L161) |
| `stop`                           | Stop the bundler. Optional - extension teardown will also call this. Provided so tests that previously called `esbuild.stop()` keep working.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L46)             |
| `transform`                      | Convenience wrapper that mirrors esbuild's `transform(code, options)` positional signature so call-sites migrating off esbuild keep their shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L35)             |

#### Types

| Name                                  | Description                                                                                  | Source                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `BuildContext`                        | Incremental/rebuild context produced by `Bundler.context`.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L269)          |
| `BuildFailure`                        | Failure thrown by `Bundler.bundle` or `Bundler.transform`.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L279)          |
| `BuildOptions`                        | Options passed to `Bundler.bundle`.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L59)           |
| `BuildResult`                         | Result returned from `Bundler.bundle`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L127)          |
| `BundleOptions`                       | Options passed to `Bundler.bundle`.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L59)           |
| `BundleOutput`                        | A single output file produced by a bundle operation.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L115)          |
| `Bundler`                             | Bundler contract interface.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L290)          |
| `BundleResult`                        | Result returned from `Bundler.bundle`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L127)          |
| `BundlerMessage`                      | A diagnostic message (error or warning) from a bundler.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L19)           |
| `BundlerMessageLocation`              | Location of an error or warning in source.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L10)           |
| `BundlerPlugin`                       | A bundler plugin that hooks into the build pipeline.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L261)          |
| `BundlerPluginBuild`                  | Build context exposed to bundler plugins.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L234)          |
| `ImportSpecifier`                     | A single import specifier position record, matching the shape produced by `es-module-lexer`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L18)      |
| `Loader`                              | Loader hint for source files. Mirrors esbuild's `Loader` type.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L139)          |
| `Message`                             | A diagnostic message (error or warning) from a bundler.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L19)           |
| `Metafile`                            | Dependency-graph metadata produced by a bundler when `metafile: true`.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L45)           |
| `MetafileInput`                       | Input file entry in a `Metafile`.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L28)           |
| `MetafileOutput`                      | Output file entry in a `Metafile`.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L35)           |
| `ModuleLexer`                         | Module lexer contract interface.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L41)      |
| `OnLoadArgs`                          | Arguments passed to an `onLoad` callback.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L215)          |
| `OnLoadResult`                        | Result returned from an `onLoad` callback.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L223)          |
| `OnResolveArgs`                       | Arguments passed to an `onResolve` callback.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L192)          |
| `OnResolveResult`                     | Result returned from an `onResolve` callback.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L203)          |
| `Plugin`                              | A bundler plugin that hooks into the build pipeline.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L261)          |
| `PluginBuild`                         | Build context exposed to bundler plugins.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L234)          |
| `ReadTypeScriptDecoratorOptionsInput` | Input for `readTypeScriptDecoratorOptions`.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/typescript-config.ts#L52) |
| `ResolveResult`                       | Result returned from an `onResolve` callback.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L203)          |
| `StdinOptions`                        | In-memory source input for `BundleOptions.stdin`.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L51)           |
| `TransformOptions`                    | Options passed to `Bundler.transform`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L156)          |
| `TransformResult`                     | Result returned from `Bundler.transform`.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L182)          |
| `TypeScriptDecoratorOptions`          | Compiler flags that control legacy TypeScript decorator transformation.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L304)          |

### `veryfront/extensions/cache`

Cache category barrel - generic cache and proxy-grade token cache.

```ts
import type { CacheStore, TokenCacheEntry, TokenCacheStats } from "veryfront/extensions/cache";
```

#### Types

| Name              | Description                                         | Source                                                                                                        |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CacheStore`      | CacheStore contract interface.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/cache-store.ts#L14)       |
| `TokenCacheEntry` | A cache entry stored by `TokenCacheStore`.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L17) |
| `TokenCacheStats` | Aggregate usage statistics for a `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L28) |
| `TokenCacheStore` | TokenCacheStore contract interface.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L41) |

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

| Name                              | Description                                                                                                                        | Source                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DocumentExtractionOptions`       |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L60) |
| `DocumentExtractionProgress`      |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L56) |
| `DocumentExtractionProgressEvent` |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L49) |
| `DocumentExtractor`               | Document extraction contract.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L69) |
| `KreuzbergExtractor`              | Shape returned by the kreuzberg document-extraction module.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L41) |
| `SqliteDatabase`                  | Minimal interface for a SQLite database connection, compatible with `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L30) |
| `SqliteStatement`                 | Minimal interface for a prepared SQLite statement, compatible with `better-sqlite3`'s `Statement` shape.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L15) |
| `SqliteStore`                     | SQLite-backed storage contract.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L94) |

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

| Name                      | Description                                                                                                                                                                                                                     | Source                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CompilationMode`         | Compilation mode. Dev surfaces extra diagnostics.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L23) |
| `CompilationTarget`       | Where the output is destined: server-side RSC or browser bundle.                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L26) |
| `ContentCompileOptions`   | Options for `ContentProcessor.compileMdx` and `ContentProcessor.compileMarkdown`.                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L45) |
| `ContentPlugin`           | Opaque unified-compatible plugin entry. Kept as an unknown-typed value or tuple so the contract surface doesn't require consumers to depend on the `unified` package directly. Callers cast to the plugin-list shape they need. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L75) |
| `ContentProcessingResult` | Processing result returned by the content pipeline.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L29) |
| `ContentProcessor`        | ContentProcessor contract for MDX/Markdown processing.                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L89) |

### `veryfront/extensions/contracts`

Contract registry - runtime resolution of extension-provided implementations.

```ts
import { register, reset, resolve } from "veryfront/extensions/contracts";
```

#### Functions

| Name         | Description                                | Source                                                                                          |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `register`   | Register.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L40) |
| `reset`      | Reset.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L55) |
| `resolve`    | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L18) |
| `tryResolve` | Try to resolve.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L34) |
| `unregister` | Unregister.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L49) |

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

| Name                                              | Description                                                                  | Source                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CSSOptimizationEngineName`                       | Registry name used for the CSS optimization extension contract.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L21) |
| `CSSProcessorName`                                | Registry name used for the CSS compiler extension contract.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L30)           |
| `CSSPurgingEngineName`                            |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L20)      |
| `MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the runtime boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L24) |
| `MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS` |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L32)           |
| `MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS`           |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L31)           |
| `MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS`      |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L21)      |

#### Functions

| Name                           | Description                                                                                                                                     | Source                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `assertCSSOptimizationEngine`  | Validate an implementation received through the dynamic contract registry.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L113) |
| `assertCSSProcessor`           | Validate an implementation received through the dynamic extension registry.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L166)           |
| `assertCSSPurgingEngine`       |                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L94)       |
| `captureCSSCompiler`           | Capture a compiler method once so accessors and later mutation cannot redirect a build.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L98)            |
| `captureCSSOptimizationEngine` | Capture dynamic properties once so later mutation or accessors cannot change the implementation that core invokes.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L123) |
| `captureCSSProcessor`          | Capture the complete processor surface once. A registry or implementation mutation can therefore affect only a subsequently acquired operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L174)           |
| `captureCSSPurgingEngine`      | Capture identity and method once so registry mutation cannot split a run.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L99)       |

#### Types

| Name                     | Description                                            | Source                                                                                                            |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `CSSCompiler`            | Stateful compiler returned by `CSSProcessor.compile`.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L37)           |
| `CSSOptimizationEngine`  | Parser-backed CSS optimization contract.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L46) |
| `CSSOptimizationRequest` | Immutable optimization request supplied by core.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L27) |
| `CSSOptimizationResult`  | Portable output returned by a CSS optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L35) |
| `CSSProcessor`           | CSSProcessor contract interface.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L53)           |
| `CSSPurgeContentSource`  |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L23)      |
| `CSSPurgingEngine`       |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L40)      |
| `CSSPurgingRequest`      |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L28)      |
| `CSSPurgingResult`       |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L35)      |

### `veryfront/extensions/database`

Database category barrel - DatabaseClient contract.

```ts
import type { DatabaseClient, QueryResult } from "veryfront/extensions/database";
```

#### Types

| Name             | Description                                  | Source                                                                                                         |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DatabaseClient` | DatabaseClient contract interface.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L23) |
| `QueryResult`    | Result returned from `DatabaseClient.query`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L10) |

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

| Name                           | Description                                                              | Source                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `DASHBOARD_CSRF_COOKIE_NAME`   | Stable prefix for port-scoped privileged dashboard session cookies.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L2)               |
| `DASHBOARD_CSRF_HEADER_NAME`   | Shared request header carrying the shell's session-bound CSRF token.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L4)               |
| `DASHBOARD_CSRF_META_NAME`     | Shared metadata name used to pass the CSRF token into the extension UI.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L6)               |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L25)              |
| `DASHBOARD_SESSION_PATH`       | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L8)               |
| `DEV_UI_KIND_ATTRIBUTE`        | Stable shell identity consumed by the extension-owned shared bundle.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L28)              |
| `DevUiAssetProviderName`       |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L9)  |
| `MAX_DEV_UI_BUNDLE_BYTES`      |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L10) |

#### Functions

| Name                            | Description                                                               | Source                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `createDevUiAssetProvider`      |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L33) |
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L17)              |
| `snapshotDevUiAssetProvider`    |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L27) |
| `validateDevUiBundle`           |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L23) |

#### Types

| Name                 | Description                                                                       | Source                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DevUiAssetProvider` | One self-contained browser bundle mounts dashboard or projects by shell identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L19) |
| `DevUiKind`          |                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L29)              |

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

| Name                           | Description                                                              | Source                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `DASHBOARD_CSRF_COOKIE_NAME`   | Stable prefix for port-scoped privileged dashboard session cookies.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L2)  |
| `DASHBOARD_CSRF_HEADER_NAME`   | Shared request header carrying the shell's session-bound CSRF token.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L4)  |
| `DASHBOARD_CSRF_META_NAME`     | Shared metadata name used to pass the CSRF token into the extension UI.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L6)  |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L25) |
| `DASHBOARD_SESSION_PATH`       | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L8)  |
| `DEV_UI_KIND_ATTRIBUTE`        | Stable shell identity consumed by the extension-owned shared bundle.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L28) |

#### Functions

| Name                            | Description                                                               | Source                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L17) |

#### Types

| Name        | Description | Source                                                                                                |
| ----------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `DevUiKind` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L29) |

### `veryfront/extensions/distributed`

Provider-neutral contracts for optional distributed runtime infrastructure.

```ts
import {
  captureRedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "veryfront/extensions/distributed";
```

#### Components

| Name                       | Description                                        | Source                                                                                                                   |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `RedisRuntimeProviderName` | Registry name used by the Redis runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L18) |

#### Functions

| Name                          | Description                                                                                                                                           | Source                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `captureRedisRuntimeProvider` | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L502) |

#### Types

| Name                                | Description                                                         | Source                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NodeRedisClient`                   | Structural node-redis client surface used by the platform adapter.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L36)  |
| `NodeRedisModule`                   | Structural module surface used by the platform Redis adapter.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L21)  |
| `RedisClient`                       | Structural client surface used by core cache features.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L97)  |
| `RedisClientHandle`                 | Independently owned Redis connection returned to a core feature.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L127) |
| `RedisClientOptions`                | Connection options accepted by the stable core Redis client facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L133) |
| `RedisEventPublisherConfig`         | Redis Pub/Sub publisher configuration.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L143) |
| `RedisEventPublisherImplementation` | Redis-backed event publisher/subscriber implementation.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L153) |
| `RedisRuntimeProvider`              | Optional Redis runtime implementation supplied by an extension.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L161) |

### `veryfront/extensions/distributed/agent-memory-support`

Provider-neutral agent-memory contracts shared with memory extensions.

```ts
import { estimateTokens } from "veryfront/extensions/distributed/agent-memory-support";
```

#### Functions

| Name             | Description | Source                                                                                                   |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `estimateTokens` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L66) |

#### Types

| Name               | Description                               | Source                                                                                                   |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Memory`           | Public API contract for memory.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L41) |
| `MemoryConfigBase` | ************************ Memory Interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L12) |
| `MemoryStats`      | Public API contract for memory stats.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L26) |
| `MinimalMessage`   |                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L32) |

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

| Name                                     | Description                                                            | Source                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DEFAULT_CACHE_TTL_SECONDS`              | Shared default used when a CacheBackend caller omits a TTL.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L81) |
| `MAX_CACHE_REVISION_LENGTH`              | Maximum number of code units in a cache revision identifier.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L18)        |
| `MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH` | Maximum source-key length before the reserved namespace is added.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L10) |
| `REVISIONED_CACHE_KEY_PREFIX`            | Reserved logical-key namespace for revisioned Veryfront cache entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L7)  |

#### Functions

| Name                                      | Description                                                                                                                                                                                                             | Source                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `assertCacheBatchSize`                    | Enforce the cache subsystem's shared per-operation batch bound.                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-policy.ts#L9)                    |
| `assertCacheReadMaximumBytes`             | Validate one caller-supplied cache payload byte ceiling.                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts#L25)                   |
| `assertCacheValueWithinLimit`             | Verify a string payload without allocating an encoded copy.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts#L33)                   |
| `buildBatchResults`                       | Build a `Map` of batch results by resolving each key in order.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-results.ts#L21)                  |
| `buildRevisionedCacheKey`                 | Add the reserved versioned namespace to one valid source key.                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L156)                  |
| `escapeCacheGlobLiteral`                  | Escape the wildcard syntax shared by cache backend pattern operations.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L316) |
| `expiresImmediately`                      |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L45)                   |
| `isRevisionedCacheBackend`                | Test whether a backend exposes the complete atomic revision capability.                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L81)                   |
| `isRevisionedCacheKey`                    | Test whether a key belongs to the valid revisioned-key builder image.                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L172)                  |
| `parseSerializedCachePayload`             | Reject oversized or malformed JSON before constructing an untrusted object graph.                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts#L1076)      |
| `registerOwnedDistributedCacheKeyPrefix`  | Register an opaque namespace without making it eligible for project invalidation.                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L300) |
| `registerRenderDistributedCacheNamespace` | Register a namespace containing render-cache keys.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L288) |
| `requireCacheExchangeResult`              | Validate a provider-returned compare-exchange result.                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L140)                  |
| `requirePositiveIntegerCacheTtlSeconds`   | Validate a constructor-level TTL for whole-second cache protocols.                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L68)                   |
| `resolveIntegerCacheTtlSeconds`           | Resolve a TTL for protocols that accept only whole seconds. Positive fractions round up so integer conversion never expires an entry earlier than requested; non-positive values retain their immediate-expiry meaning. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L37)                   |
| `serializeCachePayload`                   | Serialize using the origin-compatible payload shape.                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts#L1006)      |
| `snapshotCacheRevisionResult`             | Validate and detach a provider-returned revision snapshot.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L101)                  |
| `stripOwnedDistributedCacheKeyPrefix`     |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L320) |
| `validateDistributedCacheKeyPrefix`       |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L178) |

#### Classes

| Name                      | Description                                              | Source                                                                                        |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CacheValueTooLargeError` | Deterministic overflow from an exact bounded cache read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts#L14) |

#### Types

| Name                             | Description                                                                                                                                   | Source                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CacheBackend`                   | Provides storage operations for memory, disk, API, and extension-backed distributed caches. All cache backends must implement this interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L55)                          |
| `CachePayload`                   |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L3)                 |
| `CacheReadOptions`               | Options for a single logical backend read.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L36)                          |
| `CacheRevisionMutation`          | Atomic mutation applied when an expected cache revision still matches.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L27)                          |
| `CacheRevisionSnapshot`          | Serialized logical value and the revision that observed it.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L21)                          |
| `CacheStoreStats`                |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L14)                |
| `DistributedCacheAdministration` | Narrow administrative surface used by cache diagnostics and invalidation.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts#L64) |
| `DistributedCacheKeyListing`     | Immutable bounded cache listing with explicit completeness.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts#L58) |
| `DistributedCacheListOptions`    | Bounded provider-neutral cache listing request.                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts#L52) |
| `RenderCacheStore`               |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L18)                |
| `ResolvedCacheAuthority`         | The credential and project reference a cache backend read is made under.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/request-authority.ts#L29)              |
| `RevisionedCacheBackend`         | Cache backend with the complete atomic revision capability.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L158)                         |

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

| Name                                         | Description                                                               | Source                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `MAX_RATE_LIMIT_KEY_LENGTH`                  | Maximum UTF-16 code units accepted by a rate-limit key.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L5)   |
| `MAX_TIMER_DELAY_MS`                         | Largest delay supported consistently by JavaScript timer implementations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/limits.ts#L38)                             |
| `REDIS_RATE_LIMIT_INCREMENT_WITH_TTL_SCRIPT` | Atomic Redis script that increments a counter and assigns its TTL.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit-script.ts#L2) |

#### Functions

| Name                       | Description                                                      | Source                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `requireRateLimitKey`      |                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L7)  |
| `requireRateLimitWindowMs` |                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L25) |
| `unrefTimer`               | Unreference a timer to prevent it from keeping the process alive | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L314)                |

#### Types

| Name             | Description                               | Source                                                                                                       |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `RateLimitEntry` |                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L26) |
| `RateLimitStore` | Public API contract for rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L32) |

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

| Name                                  | Description                                                | Source                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `hasProjectIdentityControlCharacters` | Whether a string contains a Unicode Cc control code point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts#L38)      |
| `isCanonicalOpaqueProjectIdentifier`  | Whether a value is a bounded, exact opaque identifier.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts#L54)      |
| `parseProxyRoutingInvalidationEvent`  |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L328) |

#### Types

| Name                                    | Description | Source                                                                                                |
| --------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `ProxyRoutingInvalidationEvent`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L36) |
| `ProxyRoutingInvalidationPublisher`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L46) |
| `ProxyRoutingInvalidationPublishResult` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L40) |

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

| Name                             | Description                                                               | Source                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `EvalReportExporterRegistryName` | Contract name used for `resolve()` / `provide()`.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L16) |
| `EvalReportRedactedValue`        | Sentinel used when record payload fields are removed for external export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L22) |

#### Functions

| Name                               | Description                                                        | Source                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `createEvalReportExporterRegistry` | Create an eval report exporter registry.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L327) |
| `redactEvalReportForExport`        | Create an eval report copy with external-export redaction applied. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L247) |

#### Types

| Name                           | Description                                                                 | Source                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `EvalReportExportContext`      | Context passed to eval report exporters.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L59)  |
| `EvalReportExporter`           | Vendor or backend implementation that receives sanitized eval reports.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L83)  |
| `EvalReportExporterRegistry`   | Registry contract. Single impl created at bootstrap.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L112) |
| `EvalReportExportFailure`      | Failed exporter result. Failures are captured so later exporters still run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L100) |
| `EvalReportExportReceipt`      | Optional receipt returned by a vendor exporter.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L76)  |
| `EvalReportExportRedaction`    | Redaction policy applied before reports leave the process.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L25)  |
| `EvalReportExportResult`       | Result for one exporter invocation.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L107) |
| `EvalReportExportSuccess`      | Successful exporter result.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L93)  |
| `EvalReportExportTraceContext` | Trace correlation fields that connect eval exports to runtime spans.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L52)  |

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

| Name                                  | Description                                                                                                                                          | Source                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `firstPartyExtensionSourceSpecifiers` |                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L55)  |
| `importFirstPartyExtensionModule`     |                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L65)  |
| `isMissingFirstPartyExtensionModule`  | Classify a dynamic-import failure as "the extension module itself is not installed" as opposed to a real load failure inside an installed extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L247) |

#### Types

| Name                               | Description                                                       | Source                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FirstPartyExtensionImportOptions` | Optional non-root entry point for a first-party extension import. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L27) |

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

| Name                                                | Description                                                          | Source                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ImageOptimizationEngineName`                       | Registry name used for the image optimization extension contract.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L22) |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L25) |

#### Functions

| Name                             | Description                                                                | Source                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `assertImageOptimizationEngine`  | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L137) |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L144) |

#### Types

| Name                             | Description                                                               | Source                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ImageOptimizationEngine`        | Image decoder, resizer, and encoder implemented by an explicit extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L71) |
| `ImageOptimizationFormat`        | Formats core can request from an image optimization engine.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L29) |
| `ImageOptimizationRequest`       | Immutable byte-oriented request supplied by core.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L32) |
| `ImageOptimizationResult`        | Portable result returned by an image optimization engine.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L56) |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L48) |

### `veryfront/extensions/llm`

LLM category barrel - provider, embedding, and registry contracts. Interfaces re-exported with `export type { ... }` because Deno `--no-check` transpiles each file in isolation and would otherwise emit a runtime value re-export that fails ESM resolution. Reserve plain `export { ... }` for runtime values.

```ts
import { createLLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";
```

#### Components

| Name                      | Description                                       | Source                                                                                                 |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `LLMProviderRegistryName` | Contract name used for `resolve()` / `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L54) |

#### Functions

| Name                        | Description                  | Source                                                                                                          |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createLLMProviderRegistry` | Create llmprovider registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider-registry.ts#L66) |

#### Types

| Name                  | Description                                                                                                                                                                                                                                      | Source                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `EmbeddingOptions`    | Options passed to `EmbeddingProvider.embed`.                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L10) |
| `EmbeddingProvider`   | EmbeddingProvider contract interface.                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L36) |
| `EmbeddingResult`     | Result returned from `EmbeddingProvider.embed`.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L20) |
| `LLMProvider`         | An LLM provider implementation. Extensions register one of these with the `LLMProviderRegistry` during setup(). `createModel` is required; `createEmbedding` and `createResponses` are optional and absent on providers that don't support them. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L35)       |
| `LLMProviderConfig`   | Config passed to any provider's create* method.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L16)       |
| `LLMProviderRegistry` | Registry contract. Single impl created at bootstrap.                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L44)       |

### `veryfront/extensions/observability`

Observability category barrel: tracing and Node telemetry contracts.

```ts
import {
  ApplicationErrorReporterInitializerName,
  NodeTelemetryProviderName,
} from "veryfront/extensions/observability";
```

#### Components

| Name                                      | Description                                                                    | Source                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `ApplicationErrorReporterInitializerName` | Contract name used when an application composes a reporter through extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L30) |
| `NodeTelemetryProviderName`               | Contract interface for Node.js OpenTelemetry runtime bootstrap.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L9)     |

#### Types

| Name                                            | Description                                                                                                               | Source                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ApplicationErrorContext`                       | Sanitized context attached when a runtime reports an application error.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L5)             |
| `ApplicationErrorReporter`                      | Provider-neutral application error capture and flush interface.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L27)            |
| `ApplicationErrorReporterInitializationContext` | Runtime context passed to an explicitly selected reporter initializer.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L9)  |
| `ApplicationErrorReporterInitializer`           | Application-composition contract for an error-reporting implementation.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L20) |
| `ApplicationErrorReporterSession`               | Reporter and cleanup ownership returned by an application-selected initializer.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L14) |
| `NodeTelemetryInitializeOptions`                | Options accepted by node telemetry initialize.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L53)    |
| `NodeTelemetryInstrumentationConfig`            | Configuration used by node telemetry instrumentation.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L12)    |
| `NodeTelemetryLogger`                           | Public API contract for node telemetry logger.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L19)    |
| `NodeTelemetryLogRecord`                        | Structured log record shape accepted by the telemetry provider.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L30)    |
| `NodeTelemetryLogRecordEmitter`                 | Emits a structured logger record into the active telemetry pipeline.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L50)    |
| `NodeTelemetryProcessTarget`                    | Public API contract for node telemetry process target.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L25)    |
| `NodeTelemetryProvider`                         | Initializes Node-specific OpenTelemetry SDK behavior.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L85)    |
| `SpanData`                                      | Data describing a single trace span.                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L18)           |
| `TracerProvider`                                | Minimal TracerProvider interface for the contract. Structurally compatible with both the core shim and the real OTel SDK. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L13)           |
| `TracingExporter`                               | TracingExporter contract interface.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L46)           |

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

| Name                              | Description                                                       | Source                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `SkillDocumentParserProviderName` | Stable runtime identifier for the Skill document parser contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L158) |
| `YamlParserProviderName`          | Stable runtime identifier for the general YAML parser contract.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L22)            |

#### Functions

| Name                                  | Description                                                                                                                                       | Source                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `createSkillDocumentParserProvider`   | Create immutable provider registration metadata from a standalone parser.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L261) |
| `createYamlParserProvider`            | Create immutable provider registration metadata from a standalone parser.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L101)           |
| `snapshotSkillDocumentParserProvider` | Capture one immutable provider generation without retaining its mutable registration object or invoking extension-owned accessors or Proxy traps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L183) |
| `snapshotYamlParserProvider`          | Capture one immutable provider generation.                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L68)            |

#### Types

| Name                            | Description                                                                                                                                         | Source                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ASTNode`                       | A single node in an abstract syntax tree.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L10)            |
| `CodeParser`                    | Public API contract for code parser.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L90)            |
| `FunctionDirectiveOptions`      | Options for a parser-owned function directive check.                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L54)            |
| `GenerateOptions`               | Options passed to `CodeParser.generate`.                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L60)            |
| `GenerateResult`                | Result returned from `CodeParser.generate`.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L70)            |
| `InjectJsxNodePositionsOptions` | Options for `CodeParser.injectJsxNodePositions`.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L84)            |
| `NodePath`                      | Wrapper providing traversal context for a visited node.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L22)            |
| `ParseOptions`                  | Options passed to `CodeParser.parse`.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L44)            |
| `SkillDocumentParserProvider`   | Dependency-free contract implemented by Skill YAML parser extensions.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L161) |
| `TraverseVisitor`               | Visitor callbacks keyed by node type.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L34)            |
| `YamlParseOptions`              | Decoding options, named after the `@std/yaml` options the framework's call sites already pass so that repointing a call site is a specifier change. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L28)            |
| `YamlParserProvider`            | Dependency-free contract implemented by YAML parser extensions.                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L43)            |

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

| Name                                       | Description | Source                                                                                                                |
| ------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `IsolatedSsrRendererProviderName`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L19) |
| `MAX_ISOLATED_SSR_RENDERER_READ_ROOTS`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L20) |
| `MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L21) |

#### Functions

| Name                                   | Description                                                                                             | Source                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `createIsolatedSsrRendererProvider`    | Create immutable registration metadata for an extension factory.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L200) |
| `snapshotIsolatedSsrRendererProvider`  | Snapshot an extension-owned provider without invoking accessors or retaining mutable provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L92)  |
| `validateIsolatedSsrRendererModuleUrl` | Validate one worker renderer module URL without resolving or importing it.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L80)  |

#### Types

| Name                          | Description | Source                                                                                                                |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `IsolatedSsrRenderer`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L30) |
| `IsolatedSsrRendererModule`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L39) |
| `IsolatedSsrRendererProvider` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L23) |

### `veryfront/extensions/sandbox`

Sandbox category barrel.

```ts
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
```

#### Components

| Name                            | Description                               | Source                                                                                                   |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L5) |

#### Types

| Name                           | Description                                           | Source                                                                                                    |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L38) |
| `SandboxShellClient`           | Public API contract for sandbox shell client.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L30) |
| `SandboxShellToolDefinition`   | Definition for sandbox shell tool.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L13) |
| `SandboxShellToolExecute`      | Public API contract for sandbox shell tool execute.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L8)  |
| `SandboxShellToolSet`          | Public API contract for sandbox shell tool set.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L27) |
| `SandboxShellToolsProvider`    | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L47) |

### `veryfront/extensions/schema`

Schema category barrel - SchemaValidator contract and inference helpers.

```ts
import type { InferInput, InferSchema, InferShape } from "veryfront/extensions/schema";
```

#### Types

| Name                           | Description                                                                                                                                   | Source                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `InferInput`                   | Extracts the inferred _input_ type from a `Schema<T>`.                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L111) |
| `InferSchema`                  | Extracts the inferred output type `T` from a `Schema<T>`.                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L100) |
| `InferShape`                   | Maps a raw object shape to its inferred object type, preserving optionality.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L114) |
| `JsonSchema`                   |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L18)       |
| `JsonSchemaValidationFailure`  | Failed validation of an input against a compiled JSON Schema.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L173) |
| `JsonSchemaValidationFunction` | Compiled, reusable JSON Schema validation function.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L185) |
| `JsonSchemaValidationIssue`    | Stable validation issue copied from a JSON Schema validator result.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L152) |
| `JsonSchemaValidationResult`   | Result returned by a compiled JSON Schema validator.                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L180) |
| `JsonSchemaValidationSuccess`  | Successful validation of an input against a compiled JSON Schema.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L166) |
| `RefinementCtx`                | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L92)  |
| `Schema`                       | An opaque schema definition that validates and infers type `T`.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L22)  |
| `SchemaFactory`                | Factory type accepted by `defineSchema`.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L314) |
| `SchemaValidator`              | SchemaValidator contract interface.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L207) |
| `SchemaValidatorCoerce`        | Namespace for `coerce.*` constructors - accepts input in any form and coerces to the target type before validation.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L193) |
| `ValidationFailure`            | Failed validation outcome.                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L140) |
| `ValidationIssue`              | A single validation issue with location context.                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L123) |
| `ValidationResult`             | Discriminated union of validation outcomes.                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L149) |
| `ValidationSuccess`            | Successful validation outcome.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L133) |

### `veryfront/extensions/types`

Core types for the veryfront extension system.

```ts
import type { Capability, Extension, ExtensionConfigEntry } from "veryfront/extensions/types";
```

#### Types

| Name                        | Description                                                                                                        | Source                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `Capability`                | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L11) |
| `Extension`                 | Public API contract for extension.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L50) |
| `ExtensionConfigEntry`      | Entry shape for extension config.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L65) |
| `ExtensionContext`          | Context for extension.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L27) |
| `ExtensionContractMetadata` | Public API contract for extension contract metadata.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L17) |
| `ExtensionFactory`          | Public API contract for extension factory.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L62) |
| `ExtensionLogger`           | Public API contract for extension logger.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L42) |
| `ExtensionSource`           | Public API contract for extension source.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L70) |
| `PackageContractMetadata`   |                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L24) |
| `ResolvedExtension`         | Public API contract for resolved extension.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L78) |

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

| Name                                             | Description | Source                                                                                                                         |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L13) |
| `NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L12) |
| `NodeWebSocketServerProviderName`                |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L11) |

#### Functions

| Name                                  | Description                                                                                                                                                                                                    | Source                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `captureNodeWebSocketServer`          | Capture one server instance without retaining mutable method lookups. The underlying implementation remains the receiver because protocol engines legitimately keep mutable transport state on their instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L142) |
| `createNodeWebSocketServerProvider`   | Create immutable registration metadata from a standalone factory.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L231) |
| `snapshotNodeWebSocketServerProvider` | Capture a provider generation without retaining its mutable registration object or invoking extension-owned accessors.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L189) |

#### Types

| Name                          | Description                                                             | Source                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `NodeWebSocketConnection`     | Minimal connection surface consumed by core's runtime-neutral adapter.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L24) |
| `NodeWebSocketMessageData`    |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L18) |
| `NodeWebSocketServer`         | Minimal server surface used by upgrade and shutdown ownership.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L50) |
| `NodeWebSocketServerOptions`  | Exact no-server options supplied by core for an existing HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L41) |
| `NodeWebSocketServerProvider` |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L66) |
