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
| `CIRCULAR_DEPENDENCY_ERROR`                         | Shared circular dependency error value.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L27)                             |
| `EXTENSION_CONFLICT_ERROR`                          | Shared extension conflict error value.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L36)                             |
| `EXTENSION_VALIDATION_ERROR`                        | Shared extension validation error value.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L18)                             |
| `ImageOptimizationEngineName`                       | Registry name used for the image optimization extension contract.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L21)    |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L24)    |
| `MISSING_EXTENSION_ERROR`                           | Shared missing extension error value.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/errors.ts#L9)                              |
| `RedisRuntimeProviderName`                          | Registry name used by the Redis runtime extension.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L17) |
| `SandboxShellToolsProviderName`                     | Render sandbox shell tools provider name.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L4)                 |

### Functions

| Name                             | Description                                                                                                                                                                                                                      | Source                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `assertImageOptimizationEngine`  | Validate an implementation received through the dynamic contract registry.                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L136)    |
| `assertSystemReadCapability`     | Validate the bounded scope required by a `system:read` capability.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L780)                       |
| `auditCapabilities`              | Log capabilities for a named extension at startup.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L841)                       |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations.                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L143)    |
| `captureRedisRuntimeProvider`    | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L495) |
| `composeAbortSignals`            | Compose cancellation sources without depending on a mutable host `AbortSignal.any` implementation. The first source to abort owns the exact propagated reason, and listeners on every remaining source are detached immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/abort-signal.ts#L6)                         |
| `detectConflicts`                | Detect contract conflicts between resolved extensions.                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L514)                         |
| `discoverLocalExtensions`        | Find `*.extension.ts` files in the project root.                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L542)                          |
| `discoverPackageExtensions`      | Discover auto-activated package extensions without exposing identity internals.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L395)                          |
| `discoverProjectExtensions`      | Discover project extension paths without exposing identity internals.                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L529)                          |
| `formatCapabilities`             | Format capabilities as human-readable strings for logging.                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L35)                        |
| `getRecommendation`              | Return recommendation.                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/recommendations.ts#L37)                     |
| `isSupportedDenoSystemReadApi`   |                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L109)                       |
| `loadExtensionFactory`           | Dynamically import an extension factory from `path` and resolve it.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/factory-loader.ts#L99)                      |
| `mapToDenoPermissions`           | Map capabilities to Deno CLI permission flags.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/capabilities.ts#L794)                       |
| `mergeExtensions`                | Merge extensions from all four sources in priority order.                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L224)                          |
| `orchestrateExtensions`          | Run the full extension pipeline against a resolved project config.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L175)                        |
| `parseExtensionManifest`         | Parse strict JSON or the hardened JSONC subset used for Deno manifests.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/manifest-reader.ts#L686)                    |
| `parsePackageMetadata`           | Parse veryfront extension metadata from a package.json-like object.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L184)                          |
| `resolve`                        | Resolve path segments to an absolute path.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L17)                           |
| `tryResolve`                     | Try to resolve.                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L33)                           |
| `validateExtension`              | Validate the shape of an extension object. Returns an array of issue descriptions (empty array = valid).                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L353)                         |

### Classes

| Name              | Description                 | Source                                                                                        |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `ExtensionLoader` | Implement extension loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/loader.ts#L213) |

### Types

| Name                             | Description                                                                                                        | Source                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `Capability`                     | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L10)                               |
| `ConflictInfo`                   | Information about a contract conflict between extensions.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/validation.ts#L29)                          |
| `CreateSandboxShellToolsInput`   | Input payload for create sandbox shell tools.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L37)                 |
| `DiscoveredPackageExtension`     | A package extension whose manifest is bound to one physical import target.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L41)                           |
| `Extension`                      | Public API contract for extension.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L49)                               |
| `ExtensionActivationMode`        | Controls whether installation alone may activate an extension package.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L38)                           |
| `ExtensionConfigEntry`           | Entry shape for extension config.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L64)                               |
| `ExtensionContext`               | Context for extension.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L26)                               |
| `ExtensionContractMetadata`      | Public API contract for extension contract metadata.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L16)                               |
| `ExtensionFactory`               | Public API contract for extension factory.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L61)                               |
| `ExtensionLogger`                | Public API contract for extension logger.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L41)                               |
| `ExtensionSource`                | Public API contract for extension source.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L69)                               |
| `ImageOptimizationEngine`        | Image decoder, resizer, and encoder implemented by an explicit extension.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L70)     |
| `ImageOptimizationFormat`        | Formats core can request from an image optimization engine.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L28)     |
| `ImageOptimizationRequest`       | Immutable byte-oriented request supplied by core.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L31)     |
| `ImageOptimizationResult`        | Portable result returned by an image optimization engine.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L55)     |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L47)     |
| `OrchestrateOptions`             | Options for `orchestrateExtensions`.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/orchestrate.ts#L31)                         |
| `PackageMetadata`                | Metadata extracted from a package.json that declares itself as a veryfront extension.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/discovery.ts#L26)                           |
| `RedisRuntimeProvider`           | Optional Redis runtime implementation supplied by an extension.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L154) |
| `ResolvedExtension`              | Public API contract for resolved extension.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L77)                               |
| `SandboxShellClient`             | Public API contract for sandbox shell client.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L29)                 |
| `SandboxShellToolDefinition`     | Definition for sandbox shell tool.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L12)                 |
| `SandboxShellToolExecute`        | Public API contract for sandbox shell tool execute.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L7)                  |
| `SandboxShellToolSet`            | Public API contract for sandbox shell tool set.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L26)                 |
| `SandboxShellToolsProvider`      | Public API contract for sandbox shell tools provider.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L46)                 |

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
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH` | Maximum length of any one dense argument array: 50,000.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L49) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH`        | Maximum nested container depth in the detached authorization argument graph: 64.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L40) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES`        | Maximum values in the complete detached authorization argument graph: 50,000.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L43) |
| `RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES`   | Maximum aggregate array elements and record properties in the argument graph: 100,000.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L46) |
| `RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS`      | Cooperative-cancellation grace: 1,000 ms before a non-settling generation is quarantined.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L34) |
| `RSC_ACTION_AUTHORIZATION_TIMEOUT_MS`                | Default deadline for one asynchronous authorization decision: 30 seconds.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L31) |
| `RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS`                 | Maximum top-level arguments in one Server Action request: 50.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L37) |
| `RscActionAuthorizationProviderName`                 | Generation-owned contract name registered by an application-selected authorization extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L28) |

#### Functions

| Name                                     | Description                                                                                                                | Source                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `createRscActionAuthorizationProvider`   | Create immutable provider registration metadata from a standalone authorizer.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L188) |
| `snapshotRscActionAuthorizationProvider` | Capture an exact `{ authorize }` extension registration without invoking accessors or retaining mutable provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L138) |

#### Types

| Name                             | Description                                                                                                                                                                                                                 | Source                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `AuthProvider`                   | AuthProvider contract interface.                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L59)                      |
| `RscActionAuthorizationArray`    | Immutable dense data-only array with stable index and iteration semantics.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L61)  |
| `RscActionAuthorizationContext`  | Detached immutable action metadata and bounded JSON-compatible arguments.                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L72)  |
| `RscActionAuthorizationHeaders`  | Immutable null-prototype lowercase header snapshot; it contains no request body.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L85)  |
| `RscActionAuthorizationProvider` | Required generation-owned Server Action authorization contract. An absent, malformed, retiring, failed, or non-cooperative provider returns 503 with `Cache-Control: no-store`; core has no allow-all fallback.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L119) |
| `RscActionAuthorizationRecord`   | Immutable null-prototype data-only record; absent properties resolve to `undefined`.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L67)  |
| `RscActionAuthorizationRequest`  | Immutable, bodyless request metadata detached from the mutable request object.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L91)  |
| `RscActionAuthorizationValue`    | JSON-compatible, data-only value domain; numbers are always finite.                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L52)  |
| `RscActionAuthorize`             | Decide one Server Action invocation. `true` invokes the action and `false` returns 403. Throwing, rejecting, timing out, or returning a non-boolean fails closed with 503; the action is never loaded before authorization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/rsc-action-authorization-provider.ts#L109) |
| `SignOptions`                    | Options for signing a token.                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L21)                      |
| `TokenHeader`                    | The parsed, unverified header of a JWT.                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L45)                      |
| `TokenPayload`                   | Payload data stored within a signed token.                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L9)                       |
| `VerifyOptions`                  | Options for verifying a token.                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/auth/auth-provider.ts#L31)                      |

### `veryfront/extensions/bundler`

Bundler category barrel - Bundler contract, module lexer, and resolver helper.

```ts
import { build, context, getBundler } from "veryfront/extensions/bundler";
```

#### Functions

| Name         | Description                                                                                                                                      | Source                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `build`      | Convenience wrapper: `bundler.bundle(opts)`.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L26) |
| `context`    | Create an incremental build context (watch/rebuild mode).                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L51) |
| `getBundler` | Resolve the registered `Bundler` contract. Throws if no extension provides it.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L21) |
| `stop`       | Stop the bundler. Optional - extension teardown will also call this. Provided so tests that previously called `esbuild.stop()` keep working.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L45) |
| `transform`  | Convenience wrapper that mirrors esbuild's `transform(code, options)` positional signature so call-sites migrating off esbuild keep their shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/helper.ts#L34) |

#### Types

| Name                     | Description                                                                                  | Source                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `BuildContext`           | Incremental/rebuild context produced by `Bundler.context`.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L266)     |
| `BuildFailure`           | Failure thrown by `Bundler.bundle` or `Bundler.transform`.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L276)     |
| `BuildOptions`           | Options passed to `Bundler.bundle`.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L58)      |
| `BuildResult`            | Result returned from `Bundler.bundle`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L124)     |
| `BundleOptions`          | Options passed to `Bundler.bundle`.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L58)      |
| `BundleOutput`           | A single output file produced by a bundle operation.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L112)     |
| `Bundler`                | Bundler contract interface.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L287)     |
| `BundleResult`           | Result returned from `Bundler.bundle`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L124)     |
| `BundlerMessage`         | A diagnostic message (error or warning) from a bundler.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L18)      |
| `BundlerMessageLocation` | Location of an error or warning in source.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L9)       |
| `BundlerPlugin`          | A bundler plugin that hooks into the build pipeline.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L258)     |
| `BundlerPluginBuild`     | Build context exposed to bundler plugins.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L231)     |
| `ImportSpecifier`        | A single import specifier position record, matching the shape produced by `es-module-lexer`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L17) |
| `Loader`                 | Loader hint for source files. Mirrors esbuild's `Loader` type.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L136)     |
| `Message`                | A diagnostic message (error or warning) from a bundler.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L18)      |
| `Metafile`               | Dependency-graph metadata produced by a bundler when `metafile: true`.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L44)      |
| `MetafileInput`          | Input file entry in a `Metafile`.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L27)      |
| `MetafileOutput`         | Output file entry in a `Metafile`.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L34)      |
| `ModuleLexer`            | Module lexer contract interface.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/module-lexer.ts#L40) |
| `OnLoadArgs`             | Arguments passed to an `onLoad` callback.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L212)     |
| `OnLoadResult`           | Result returned from an `onLoad` callback.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L220)     |
| `OnResolveArgs`          | Arguments passed to an `onResolve` callback.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L189)     |
| `OnResolveResult`        | Result returned from an `onResolve` callback.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L200)     |
| `Plugin`                 | A bundler plugin that hooks into the build pipeline.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L258)     |
| `PluginBuild`            | Build context exposed to bundler plugins.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L231)     |
| `ResolveResult`          | Result returned from an `onResolve` callback.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L200)     |
| `StdinOptions`           | In-memory source input for `BundleOptions.stdin`.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L50)      |
| `TransformOptions`       | Options passed to `Bundler.transform`.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L153)     |
| `TransformResult`        | Result returned from `Bundler.transform`.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/bundler/bundler.ts#L179)     |

### `veryfront/extensions/cache`

Cache category barrel - generic cache and proxy-grade token cache.

```ts
import type { CacheStore, TokenCacheEntry, TokenCacheStats } from "veryfront/extensions/cache";
```

#### Types

| Name              | Description                                         | Source                                                                                                        |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CacheStore`      | CacheStore contract interface.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/cache-store.ts#L13)       |
| `TokenCacheEntry` | A cache entry stored by `TokenCacheStore`.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L16) |
| `TokenCacheStats` | Aggregate usage statistics for a `TokenCacheStore`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L27) |
| `TokenCacheStore` | TokenCacheStore contract interface.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/cache/token-cache-store.ts#L40) |

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
| `DocumentExtractionOptions`       |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L59) |
| `DocumentExtractionProgress`      |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L55) |
| `DocumentExtractionProgressEvent` |                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L48) |
| `DocumentExtractor`               | Document extraction contract.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L68) |
| `KreuzbergExtractor`              | Shape returned by the kreuzberg document-extraction module.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L40) |
| `SqliteDatabase`                  | Minimal interface for a SQLite database connection, compatible with `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L29) |
| `SqliteStatement`                 | Minimal interface for a prepared SQLite statement, compatible with `better-sqlite3`'s `Statement` shape.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L14) |
| `SqliteStore`                     | SQLite-backed storage contract.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/compat/native-services.ts#L93) |

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
| `CompilationMode`         | Compilation mode. Dev surfaces extra diagnostics.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L22) |
| `CompilationTarget`       | Where the output is destined: server-side RSC or browser bundle.                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L25) |
| `ContentCompileOptions`   | Options for `ContentProcessor.compileMdx` and `ContentProcessor.compileMarkdown`.                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L44) |
| `ContentPlugin`           | Opaque unified-compatible plugin entry. Kept as an unknown-typed value or tuple so the contract surface doesn't require consumers to depend on the `unified` package directly. Callers cast to the plugin-list shape they need. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L74) |
| `ContentProcessingResult` | Processing result returned by the content pipeline.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L28) |
| `ContentProcessor`        | ContentProcessor contract for MDX/Markdown processing.                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/content/content-processor.ts#L88) |

### `veryfront/extensions/contracts`

Contract registry - runtime resolution of extension-provided implementations.

```ts
import { register, reset, resolve } from "veryfront/extensions/contracts";
```

#### Functions

| Name         | Description                                | Source                                                                                          |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `register`   | Register.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L39) |
| `reset`      | Reset.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L54) |
| `resolve`    | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L17) |
| `tryResolve` | Try to resolve.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L33) |
| `unregister` | Unregister.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/contracts.ts#L48) |

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
| `CSSOptimizationEngineName`                       | Registry name used for the CSS optimization extension contract.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L20) |
| `CSSProcessorName`                                | Registry name used for the CSS compiler extension contract.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L29)           |
| `CSSPurgingEngineName`                            |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L19)      |
| `MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the runtime boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L23) |
| `MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS` |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L31)           |
| `MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS`           |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L30)           |
| `MAX_CSS_PURGING_ENGINE_IDENTITY_CHARACTERS`      |                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L20)      |

#### Functions

| Name                           | Description                                                                                                                                     | Source                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `assertCSSOptimizationEngine`  | Validate an implementation received through the dynamic contract registry.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L112) |
| `assertCSSProcessor`           | Validate an implementation received through the dynamic extension registry.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L165)           |
| `assertCSSPurgingEngine`       |                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L93)       |
| `captureCSSCompiler`           | Capture a compiler method once so accessors and later mutation cannot redirect a build.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L97)            |
| `captureCSSOptimizationEngine` | Capture dynamic properties once so later mutation or accessors cannot change the implementation that core invokes.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L122) |
| `captureCSSProcessor`          | Capture the complete processor surface once. A registry or implementation mutation can therefore affect only a subsequently acquired operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L173)           |
| `captureCSSPurgingEngine`      | Capture identity and method once so registry mutation cannot split a run.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L98)       |

#### Types

| Name                     | Description                                            | Source                                                                                                            |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `CSSCompiler`            | Stateful compiler returned by `CSSProcessor.compile`.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L36)           |
| `CSSOptimizationEngine`  | Parser-backed CSS optimization contract.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L45) |
| `CSSOptimizationRequest` | Immutable optimization request supplied by core.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L26) |
| `CSSOptimizationResult`  | Portable output returned by a CSS optimization engine. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-optimization-engine.ts#L34) |
| `CSSProcessor`           | CSSProcessor contract interface.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-processor.ts#L52)           |
| `CSSPurgeContentSource`  |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L22)      |
| `CSSPurgingEngine`       |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L39)      |
| `CSSPurgingRequest`      |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L27)      |
| `CSSPurgingResult`       |                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/css/css-purging-engine.ts#L34)      |

### `veryfront/extensions/database`

Database category barrel - DatabaseClient contract.

```ts
import type { DatabaseClient, QueryResult } from "veryfront/extensions/database";
```

#### Types

| Name             | Description                                  | Source                                                                                                         |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DatabaseClient` | DatabaseClient contract interface.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L22) |
| `QueryResult`    | Result returned from `DatabaseClient.query`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/database/database-client.ts#L9)  |

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

| Name                           | Description                                                              | Source                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `DASHBOARD_CSRF_COOKIE_NAME`   | Stable prefix for port-scoped privileged dashboard session cookies.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L1)              |
| `DASHBOARD_CSRF_HEADER_NAME`   | Shared request header carrying the shell's session-bound CSRF token.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L3)              |
| `DASHBOARD_CSRF_META_NAME`     | Shared metadata name used to pass the CSRF token into the extension UI.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L5)              |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L24)             |
| `DASHBOARD_SESSION_PATH`       | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L7)              |
| `DEV_UI_KIND_ATTRIBUTE`        | Stable shell identity consumed by the extension-owned shared bundle.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L27)             |
| `DevUiAssetProviderName`       |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L8) |
| `MAX_DEV_UI_BUNDLE_BYTES`      |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L9) |

#### Functions

| Name                            | Description                                                               | Source                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `createDevUiAssetProvider`      |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L32) |
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L16)              |
| `snapshotDevUiAssetProvider`    |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L26) |
| `validateDevUiBundle`           |                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L22) |

#### Types

| Name                 | Description                                                                       | Source                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DevUiAssetProvider` | One self-contained browser bundle mounts dashboard or projects by shell identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/dev-ui-asset-provider.ts#L18) |
| `DevUiKind`          |                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L28)              |

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
| `DASHBOARD_CSRF_COOKIE_NAME`   | Stable prefix for port-scoped privileged dashboard session cookies.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L1)  |
| `DASHBOARD_CSRF_HEADER_NAME`   | Shared request header carrying the shell's session-bound CSRF token.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L3)  |
| `DASHBOARD_CSRF_META_NAME`     | Shared metadata name used to pass the CSRF token into the extension UI.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L5)  |
| `DASHBOARD_CSRF_TOKEN_PATTERN` | A 32-byte token encoded as unpadded base64url.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L24) |
| `DASHBOARD_SESSION_PATH`       | Asset-independent endpoint used by trusted headless development clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L7)  |
| `DEV_UI_KIND_ATTRIBUTE`        | Stable shell identity consumed by the extension-owned shared bundle.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L27) |

#### Functions

| Name                            | Description                                                               | Source                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `getDashboardSessionCookieName` | Derive the host cookie name for one concrete development-server listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L16) |

#### Types

| Name        | Description | Source                                                                                                |
| ----------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `DevUiKind` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/dev-ui/protocol.ts#L28) |

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
| `RedisRuntimeProviderName` | Registry name used by the Redis runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L17) |

#### Functions

| Name                          | Description                                                                                                                                           | Source                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `captureRedisRuntimeProvider` | Validate and snapshot a provider before core invokes extension-owned code. Accessors are rejected so registration cannot execute code during capture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L495) |

#### Types

| Name                                | Description                                                         | Source                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NodeRedisClient`                   | Structural node-redis client surface used by the platform adapter.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L35)  |
| `NodeRedisModule`                   | Structural module surface used by the platform Redis adapter.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L20)  |
| `RedisClient`                       | Structural client surface used by core cache features.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L90)  |
| `RedisClientHandle`                 | Independently owned Redis connection returned to a core feature.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L120) |
| `RedisClientOptions`                | Connection options accepted by the stable core Redis client facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L126) |
| `RedisEventPublisherConfig`         | Redis Pub/Sub publisher configuration.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L136) |
| `RedisEventPublisherImplementation` | Redis-backed event publisher/subscriber implementation.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L146) |
| `RedisRuntimeProvider`              | Optional Redis runtime implementation supplied by an extension.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L154) |

### `veryfront/extensions/distributed/agent-memory-support`

Provider-neutral agent-memory contracts shared with memory extensions.

```ts
import { estimateTokens } from "veryfront/extensions/distributed/agent-memory-support";
```

#### Functions

| Name             | Description | Source                                                                                                   |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `estimateTokens` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L65) |

#### Types

| Name               | Description                               | Source                                                                                                   |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Memory`           | Public API contract for memory.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L40) |
| `MemoryConfigBase` | ************************ Memory Interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L11) |
| `MemoryStats`      | Public API contract for memory stats.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L25) |
| `MinimalMessage`   |                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L31) |

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
| `DEFAULT_CACHE_TTL_SECONDS`              | Shared default used when a CacheBackend caller omits a TTL.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L80) |
| `MAX_CACHE_REVISION_LENGTH`              | Maximum number of code units in a cache revision identifier.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L16)        |
| `MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH` | Maximum source-key length before the reserved namespace is added.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L9)  |
| `REVISIONED_CACHE_KEY_PREFIX`            | Reserved logical-key namespace for revisioned Veryfront cache entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L6)  |

#### Functions

| Name                                      | Description                                                                                                                                                                                                             | Source                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `assertCacheBatchSize`                    | Enforce the cache subsystem's shared per-operation batch bound.                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-policy.ts#L8)                    |
| `assertCacheReadMaximumBytes`             | Validate one caller-supplied cache payload byte ceiling.                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts#L24)                   |
| `assertCacheValueWithinLimit`             | Verify a string payload without allocating an encoded copy.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts#L32)                   |
| `buildBatchResults`                       | Build a `Map` of batch results by resolving each key in order.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/batch-results.ts#L20)                  |
| `buildRevisionedCacheKey`                 | Add the reserved versioned namespace to one valid source key.                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L155)                  |
| `escapeCacheGlobLiteral`                  | Escape the wildcard syntax shared by cache backend pattern operations.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L315) |
| `expiresImmediately`                      |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L44)                   |
| `isRevisionedCacheBackend`                | Test whether a backend exposes the complete atomic revision capability.                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L80)                   |
| `isRevisionedCacheKey`                    | Test whether a key belongs to the valid revisioned-key builder image.                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L171)                  |
| `parseSerializedCachePayload`             | Reject oversized or malformed JSON before constructing an untrusted object graph.                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts#L1018)      |
| `registerOwnedDistributedCacheKeyPrefix`  | Register an opaque namespace without making it eligible for project invalidation.                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L299) |
| `registerRenderDistributedCacheNamespace` | Register a namespace containing render-cache keys.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L287) |
| `requireCacheExchangeResult`              | Validate a provider-returned compare-exchange result.                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L139)                  |
| `requirePositiveIntegerCacheTtlSeconds`   | Validate a constructor-level TTL for whole-second cache protocols.                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L67)                   |
| `resolveIntegerCacheTtlSeconds`           | Resolve a TTL for protocols that accept only whole seconds. Positive fractions round up so integer conversion never expires an entry earlier than requested; non-positive values retain their immediate-expiry meaning. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/ttl.ts#L36)                   |
| `serializeCachePayload`                   | Serialize using the origin-compatible payload shape.                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/cache-payload.ts#L949)       |
| `snapshotCacheRevisionResult`             | Validate and detach a provider-returned revision snapshot.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/capabilities.ts#L100)                  |
| `stripOwnedDistributedCacheKeyPrefix`     |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L319) |
| `validateDistributedCacheKeyPrefix`       |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/backends/distributed-keyspace.ts#L177) |

#### Classes

| Name                      | Description                                              | Source                                                                                        |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CacheValueTooLargeError` | Deterministic overflow from an exact bounded cache read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/bounded-read.ts#L13) |

#### Types

| Name                             | Description                                                                                                                                   | Source                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CacheBackend`                   | Provides storage operations for memory, disk, API, and extension-backed distributed caches. All cache backends must implement this interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L37)                          |
| `CachePayload`                   |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L2)                 |
| `CacheRevisionMutation`          | Atomic mutation applied when an expected cache revision still matches.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L25)                          |
| `CacheRevisionSnapshot`          | Serialized logical value and the revision that observed it.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L19)                          |
| `CacheStoreStats`                |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L13)                |
| `DistributedCacheAdministration` | Narrow administrative surface used by cache diagnostics and invalidation.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts#L61) |
| `DistributedCacheKeyListing`     | Immutable bounded cache listing with explicit completeness.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts#L55) |
| `DistributedCacheListOptions`    | Bounded provider-neutral cache listing request.                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/cache-support.ts#L49) |
| `RenderCacheStore`               |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/rendering/cache/types.ts#L17)                |
| `RevisionedCacheBackend`         | Cache backend with the complete atomic revision capability.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/cache/types.ts#L127)                         |

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
| `MAX_RATE_LIMIT_KEY_LENGTH`                  | Maximum UTF-16 code units accepted by a rate-limit key.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L4)   |
| `MAX_TIMER_DELAY_MS`                         | Largest delay supported consistently by JavaScript timer implementations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/limits.ts#L37)                             |
| `REDIS_RATE_LIMIT_INCREMENT_WITH_TTL_SCRIPT` | Atomic Redis script that increments a counter and assigns its TTL.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit-script.ts#L1) |

#### Functions

| Name                       | Description                                                      | Source                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `requireRateLimitKey`      |                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L6)  |
| `requireRateLimitWindowMs` |                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit-validation.ts#L24) |
| `unrefTimer`               | Unreference a timer to prevent it from keeping the process alive | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L286)                |

#### Types

| Name             | Description                               | Source                                                                                                       |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `RateLimitEntry` |                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L25) |
| `RateLimitStore` | Public API contract for rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L31) |

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
| `hasProjectIdentityControlCharacters` | Whether a string contains a Unicode Cc control code point. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts#L37)      |
| `isCanonicalOpaqueProjectIdentifier`  | Whether a value is a bounded, exact opaque identifier.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/project-identity.ts#L53)      |
| `parseProxyRoutingInvalidationEvent`  |                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L174) |

#### Types

| Name                                    | Description | Source                                                                                                |
| --------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `ProxyRoutingInvalidationEvent`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L29) |
| `ProxyRoutingInvalidationPublisher`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L39) |
| `ProxyRoutingInvalidationPublishResult` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/proxy/routing-invalidation.ts#L33) |

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
| `EvalReportExporterRegistryName` | Contract name used for `resolve()` / `provide()`.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L15) |
| `EvalReportRedactedValue`        | Sentinel used when record payload fields are removed for external export. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L21) |

#### Functions

| Name                               | Description                                                        | Source                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `createEvalReportExporterRegistry` | Create an eval report exporter registry.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L326) |
| `redactEvalReportForExport`        | Create an eval report copy with external-export redaction applied. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L246) |

#### Types

| Name                           | Description                                                                 | Source                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `EvalReportExportContext`      | Context passed to eval report exporters.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L58)  |
| `EvalReportExporter`           | Vendor or backend implementation that receives sanitized eval reports.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L82)  |
| `EvalReportExporterRegistry`   | Registry contract. Single impl created at bootstrap.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L111) |
| `EvalReportExportFailure`      | Failed exporter result. Failures are captured so later exporters still run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L99)  |
| `EvalReportExportReceipt`      | Optional receipt returned by a vendor exporter.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L75)  |
| `EvalReportExportRedaction`    | Redaction policy applied before reports leave the process.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L24)  |
| `EvalReportExportResult`       | Result for one exporter invocation.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L106) |
| `EvalReportExportSuccess`      | Successful exporter result.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L92)  |
| `EvalReportExportTraceContext` | Trace correlation fields that connect eval exports to runtime spans.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/eval/eval-report-exporter.ts#L51)  |

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
| `firstPartyExtensionSourceSpecifiers` |                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L43)  |
| `importFirstPartyExtensionModule`     |                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L53)  |
| `isMissingFirstPartyExtensionModule`  | Classify a dynamic-import failure as "the extension module itself is not installed" as opposed to a real load failure inside an installed extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L235) |

#### Types

| Name                               | Description                                                       | Source                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FirstPartyExtensionImportOptions` | Optional non-root entry point for a first-party extension import. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/first-party-import.ts#L20) |

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
| `ImageOptimizationEngineName`                       | Registry name used for the image optimization extension contract.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L21) |
| `MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS` | Maximum stable implementation identity accepted across the boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L24) |

#### Functions

| Name                             | Description                                                                | Source                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `assertImageOptimizationEngine`  | Validate an implementation received through the dynamic contract registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L136) |
| `captureImageOptimizationEngine` | Capture dynamic properties once so one run cannot split across mutations.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L143) |

#### Types

| Name                             | Description                                                               | Source                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ImageOptimizationEngine`        | Image decoder, resizer, and encoder implemented by an explicit extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L70) |
| `ImageOptimizationFormat`        | Formats core can request from an image optimization engine.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L28) |
| `ImageOptimizationRequest`       | Immutable byte-oriented request supplied by core.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L31) |
| `ImageOptimizationResult`        | Portable result returned by an image optimization engine.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L55) |
| `ImageOptimizationVariantResult` | One encoded output returned by an image optimization engine.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/image/image-optimization-engine.ts#L47) |

### `veryfront/extensions/llm`

LLM category barrel - provider, embedding, and registry contracts. Interfaces re-exported with `export type { ... }` because Deno `--no-check` transpiles each file in isolation and would otherwise emit a runtime value re-export that fails ESM resolution. Reserve plain `export { ... }` for runtime values.

```ts
import { createLLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";
```

#### Components

| Name                      | Description                                       | Source                                                                                                 |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `LLMProviderRegistryName` | Contract name used for `resolve()` / `provide()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L53) |

#### Functions

| Name                        | Description                  | Source                                                                                                          |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createLLMProviderRegistry` | Create llmprovider registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider-registry.ts#L65) |

#### Types

| Name                  | Description                                                                                                                                                                                                                                      | Source                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `EmbeddingOptions`    | Options passed to `EmbeddingProvider.embed`.                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L9)  |
| `EmbeddingProvider`   | EmbeddingProvider contract interface.                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L35) |
| `EmbeddingResult`     | Result returned from `EmbeddingProvider.embed`.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/embedding-provider.ts#L19) |
| `LLMProvider`         | An LLM provider implementation. Extensions register one of these with the `LLMProviderRegistry` during setup(). `createModel` is required; `createEmbedding` and `createResponses` are optional and absent on providers that don't support them. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L34)       |
| `LLMProviderConfig`   | Config passed to any provider's create* method.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L15)       |
| `LLMProviderRegistry` | Registry contract. Single impl created at bootstrap.                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/llm/llm-provider.ts#L43)       |

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
| `ApplicationErrorReporterInitializerName` | Contract name used when an application composes a reporter through extensions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L29) |
| `NodeTelemetryProviderName`               | Contract interface for Node.js OpenTelemetry runtime bootstrap.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L8)     |

#### Types

| Name                                            | Description                                                                                                               | Source                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ApplicationErrorContext`                       | Sanitized context attached when a runtime reports an application error.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L4)             |
| `ApplicationErrorReporter`                      | Provider-neutral application error capture and flush interface.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/observability/application-error-contract.ts#L22)            |
| `ApplicationErrorReporterInitializationContext` | Runtime context passed to an explicitly selected reporter initializer.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L8)  |
| `ApplicationErrorReporterInitializer`           | Application-composition contract for an error-reporting implementation.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L19) |
| `ApplicationErrorReporterSession`               | Reporter and cleanup ownership returned by an application-selected initializer.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/application-error-reporter.ts#L13) |
| `NodeTelemetryInitializeOptions`                | Options accepted by node telemetry initialize.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L52)    |
| `NodeTelemetryInstrumentationConfig`            | Configuration used by node telemetry instrumentation.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L11)    |
| `NodeTelemetryLogger`                           | Public API contract for node telemetry logger.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L18)    |
| `NodeTelemetryLogRecord`                        | Structured log record shape accepted by the telemetry provider.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L29)    |
| `NodeTelemetryLogRecordEmitter`                 | Emits a structured logger record into the active telemetry pipeline.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L49)    |
| `NodeTelemetryProcessTarget`                    | Public API contract for node telemetry process target.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L24)    |
| `NodeTelemetryProvider`                         | Initializes Node-specific OpenTelemetry SDK behavior.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/node-telemetry-provider.ts#L84)    |
| `SpanData`                                      | Data describing a single trace span.                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L17)           |
| `TracerProvider`                                | Minimal TracerProvider interface for the contract. Structurally compatible with both the core shim and the real OTel SDK. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L12)           |
| `TracingExporter`                               | TracingExporter contract interface.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/observability/tracing-exporter.ts#L45)           |

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
| `SkillDocumentParserProviderName` | Stable runtime identifier for the Skill document parser contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L157) |
| `YamlParserProviderName`          | Stable runtime identifier for the general YAML parser contract.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L21)            |

#### Functions

| Name                                  | Description                                                                                                                                       | Source                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `createSkillDocumentParserProvider`   | Create immutable provider registration metadata from a standalone parser.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L260) |
| `createYamlParserProvider`            | Create immutable provider registration metadata from a standalone parser.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L100)           |
| `snapshotSkillDocumentParserProvider` | Capture one immutable provider generation without retaining its mutable registration object or invoking extension-owned accessors or Proxy traps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L182) |
| `snapshotYamlParserProvider`          | Capture one immutable provider generation.                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L67)            |

#### Types

| Name                            | Description                                                                                                                                         | Source                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ASTNode`                       | A single node in an abstract syntax tree.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L9)             |
| `CodeParser`                    | Public API contract for code parser.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L89)            |
| `FunctionDirectiveOptions`      | Options for a parser-owned function directive check.                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L53)            |
| `GenerateOptions`               | Options passed to `CodeParser.generate`.                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L59)            |
| `GenerateResult`                | Result returned from `CodeParser.generate`.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L69)            |
| `InjectJsxNodePositionsOptions` | Options for `CodeParser.injectJsxNodePositions`.                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L83)            |
| `NodePath`                      | Wrapper providing traversal context for a visited node.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L21)            |
| `ParseOptions`                  | Options passed to `CodeParser.parse`.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L43)            |
| `SkillDocumentParserProvider`   | Dependency-free contract implemented by Skill YAML parser extensions.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/skill-document-parser.ts#L160) |
| `TraverseVisitor`               | Visitor callbacks keyed by node type.                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/code-parser.ts#L33)            |
| `YamlParseOptions`              | Decoding options, named after the `@std/yaml` options the framework's call sites already pass so that repointing a call site is a specifier change. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L27)            |
| `YamlParserProvider`            | Dependency-free contract implemented by YAML parser extensions.                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/parser/yaml-parser.ts#L42)            |

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
| `IsolatedSsrRendererProviderName`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L18) |
| `MAX_ISOLATED_SSR_RENDERER_READ_ROOTS`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L19) |
| `MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L20) |

#### Functions

| Name                                   | Description                                                                                             | Source                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `createIsolatedSsrRendererProvider`    | Create immutable registration metadata for an extension factory.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L199) |
| `snapshotIsolatedSsrRendererProvider`  | Snapshot an extension-owned provider without invoking accessors or retaining mutable provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L91)  |
| `validateIsolatedSsrRendererModuleUrl` | Validate one worker renderer module URL without resolving or importing it.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L79)  |

#### Types

| Name                          | Description | Source                                                                                                                |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `IsolatedSsrRenderer`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L29) |
| `IsolatedSsrRendererModule`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L38) |
| `IsolatedSsrRendererProvider` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/rendering/isolated-ssr-renderer.ts#L22) |

### `veryfront/extensions/sandbox`

Sandbox category barrel.

```ts
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
```

#### Components

| Name                            | Description                               | Source                                                                                                   |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SandboxShellToolsProviderName` | Render sandbox shell tools provider name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L4) |

#### Types

| Name                           | Description                                           | Source                                                                                                    |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L37) |
| `SandboxShellClient`           | Public API contract for sandbox shell client.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L29) |
| `SandboxShellToolDefinition`   | Definition for sandbox shell tool.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L12) |
| `SandboxShellToolExecute`      | Public API contract for sandbox shell tool execute.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L7)  |
| `SandboxShellToolSet`          | Public API contract for sandbox shell tool set.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L26) |
| `SandboxShellToolsProvider`    | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L46) |

### `veryfront/extensions/schema`

Schema category barrel - SchemaValidator contract and inference helpers.

```ts
import type { InferInput, InferSchema, InferShape } from "veryfront/extensions/schema";
```

#### Types

| Name                           | Description                                                                                                                                   | Source                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `InferInput`                   | Extracts the inferred _input_ type from a `Schema<T>`.                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L110) |
| `InferSchema`                  | Extracts the inferred output type `T` from a `Schema<T>`.                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L99)  |
| `InferShape`                   | Maps a raw object shape to its inferred object type, preserving optionality.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L113) |
| `JsonSchema`                   |                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L17)       |
| `JsonSchemaValidationFailure`  | Failed validation of an input against a compiled JSON Schema.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L172) |
| `JsonSchemaValidationFunction` | Compiled, reusable JSON Schema validation function.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L184) |
| `JsonSchemaValidationIssue`    | Stable validation issue copied from a JSON Schema validator result.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L151) |
| `JsonSchemaValidationResult`   | Result returned by a compiled JSON Schema validator.                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L179) |
| `JsonSchemaValidationSuccess`  | Successful validation of an input against a compiled JSON Schema.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L165) |
| `RefinementCtx`                | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L91)  |
| `Schema`                       | An opaque schema definition that validates and infers type `T`.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L21)  |
| `SchemaFactory`                | Factory type accepted by `defineSchema`.                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L313) |
| `SchemaValidator`              | SchemaValidator contract interface.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L206) |
| `SchemaValidatorCoerce`        | Namespace for `coerce.*` constructors - accepts input in any form and coerces to the target type before validation.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L192) |
| `ValidationFailure`            | Failed validation outcome.                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L139) |
| `ValidationIssue`              | A single validation issue with location context.                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L122) |
| `ValidationResult`             | Discriminated union of validation outcomes.                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L148) |
| `ValidationSuccess`            | Successful validation outcome.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L132) |

### `veryfront/extensions/types`

Core types for the veryfront extension system.

```ts
import type { Capability, Extension, ExtensionConfigEntry } from "veryfront/extensions/types";
```

#### Types

| Name                        | Description                                                                                                        | Source                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `Capability`                | Declares a system capability an extension requires. Object-based for extensibility -- scoping fields vary by type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L10) |
| `Extension`                 | Public API contract for extension.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L49) |
| `ExtensionConfigEntry`      | Entry shape for extension config.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L64) |
| `ExtensionContext`          | Context for extension.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L26) |
| `ExtensionContractMetadata` | Public API contract for extension contract metadata.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L16) |
| `ExtensionFactory`          | Public API contract for extension factory.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L61) |
| `ExtensionLogger`           | Public API contract for extension logger.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L41) |
| `ExtensionSource`           | Public API contract for extension source.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L69) |
| `PackageContractMetadata`   |                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L23) |
| `ResolvedExtension`         | Public API contract for resolved extension.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/types.ts#L77) |

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
| `NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L12) |
| `NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L11) |
| `NodeWebSocketServerProviderName`                |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L10) |

#### Functions

| Name                                  | Description                                                                                                                                                                                                    | Source                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `captureNodeWebSocketServer`          | Capture one server instance without retaining mutable method lookups. The underlying implementation remains the receiver because protocol engines legitimately keep mutable transport state on their instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L141) |
| `createNodeWebSocketServerProvider`   | Create immutable registration metadata from a standalone factory.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L230) |
| `snapshotNodeWebSocketServerProvider` | Capture a provider generation without retaining its mutable registration object or invoking extension-owned accessors.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L188) |

#### Types

| Name                          | Description                                                             | Source                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `NodeWebSocketConnection`     | Minimal connection surface consumed by core's runtime-neutral adapter.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L23) |
| `NodeWebSocketMessageData`    |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L17) |
| `NodeWebSocketServer`         | Minimal server surface used by upgrade and shutdown ownership.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L49) |
| `NodeWebSocketServerOptions`  | Exact no-server options supplied by core for an existing HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L40) |
| `NodeWebSocketServerProvider` |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/websocket/node-websocket-server-provider.ts#L65) |
