---
title: "veryfront/server"
description: "Create and run Veryfront servers."
order: 38
---

## Import

```ts
import {
  createHandler,
  createProductionShutdownCoordinator,
  createVeryfrontServer,
  gracefullyShutdownProductionServer,
  isHostedEnvironmentName,
  isHostedHttpIsolationEnabled,
} from "veryfront/server";
```

## Examples

### Composable service server

```ts
import { createVeryfrontServer } from "veryfront/server";

const server = createVeryfrontServer({
  modules: [{
    name: "agent",
    handle: (request) => new Response(`Handled ${request.url}`),
  }],
});

await server.fetch(new Request("https://example.com/health"));
```

## Exports

### Components

| Name                        | Description                                                                                   | Source                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `HOSTED_ENVIRONMENT_NAMES`  | Environment labels that `{slug}.{environment}.veryfront.com` actually routes.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts)            |
| `HOSTED_HTTP_ISOLATION_ENV` | Host flag that enables isolated hosted HTTP execution. Default off. Node.js 22 or newer only. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-flag.ts) |
| `ReloadNotifier`            | Render reload notifier.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/reload-notifier.ts)                |

### Functions

| Name                                  | Description                                                                                                                                                                                                                                                    | Source                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `createHandler`                       | Create a Veryfront request handler for development or production.                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)                           |
| `createProductionShutdownCoordinator` | Coordinates competing process shutdown triggers through one drain and exit.                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-shutdown-coordinator.ts) |
| `createVeryfrontServer`               | Create veryfront server.                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `gracefullyShutdownProductionServer`  | Enter lame-duck mode, mark readiness false, drain tracked requests and SSE response bodies, and stop a production server process.                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts)               |
| `isHostedEnvironmentName`             | Whether `{slug}.{name}.veryfront.com` is a host the platform can route.                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts)             |
| `isHostedHttpIsolationEnabled`        | Read the hosted HTTP isolation flag from the host environment, excluding project env files. Unset, `0`, `false`, `no` and `off` are off; `1`, `true`, `yes` and `on` are on. Any other value throws, so a misspelled flag never silently leaves isolation off. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-flag.ts)  |
| `parseProjectDomain`                  | Extract project slug and branch from domain/host header                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts)             |
| `parseShutdownCleanupTimeoutMs`       | Parse the configured post-drain cleanup timeout or return the production default.                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts)               |
| `parseShutdownDrainTimeoutMs`         | Parse the configured request-drain timeout or return the production default.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts)               |
| `runProductionProcessOwner`           | Own a production server from startup through one process exit.                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-shutdown-coordinator.ts) |
| `startDevServer`                      | Starts dev server.                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/index.ts)                |
| `startNodeVeryfrontServer`            | Starts node veryfront server.                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `startProductionServer`               | Starts production server.                                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)               |
| `startServer`                         | Start a Veryfront server in development or production mode.                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)                           |
| `startVeryfrontServer`                | Starts veryfront server.                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `toNodeHandler`                       | Convert a Web API request handler into a Node.js HTTP listener.                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts)                    |

### Classes

| Name             | Description           | Source                                                                                                   |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `DevServer`      | Implement dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/server.ts)          |
| `RouteDiscovery` |                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/route-discovery.ts) |

### Types

| Name                                   | Description                                                                                              | Source                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BuildOptions`                         | Build System Type Definitions Consolidated from cli/commands/build/types.ts and server/build-types.ts    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts)                     |
| `BuildStats`                           | Public API contract for build stats.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts)                     |
| `CreateVeryfrontServerOptions`         | Options accepted by create veryfront server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `DevServerHandler`                     | Public handler returned by a handler-only dev server.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)                |
| `DevServerOptions`                     | Options accepted by dev server.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)                |
| `DiscoveryOptions`                     | Configuration for AI primitives discovery during server startup                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)               |
| `FileWatcherMetrics`                   | Public API contract for file watcher metrics.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)                |
| `GracefulProductionShutdownOptions`    | Inputs required to drain and stop a production server process.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts)               |
| `HostedEnvironmentName`                |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts)             |
| `MemoryRecycleEvent`                   | Process RSS sample and policy values when recycling is requested.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memory/profiler.ts)                  |
| `NodeVeryfrontServiceServer`           | Public API contract for node veryfront service server.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `OwnedProductionServer`                |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-shutdown-coordinator.ts) |
| `ProductionProcessOwnerOptions`        |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-shutdown-coordinator.ts) |
| `ProductionShutdownCoordinator`        |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-shutdown-coordinator.ts) |
| `ProductionShutdownCoordinatorOptions` | Callbacks and finalization deadline for one coordinated process shutdown.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-shutdown-coordinator.ts) |
| `ProductionShutdownReason`             |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-shutdown-coordinator.ts) |
| `RouteDirectory`                       | Public API contract for route directory.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)                |
| `ServerHandle`                         | Public API contract for server handle.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)               |
| `StartDevModeOptions`                  | Options accepted by start dev mode.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)                           |
| `StartNodeVeryfrontServerOptions`      | Options accepted by start node veryfront server.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `StartProductionModeOptions`           | Options accepted by start production mode.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)                           |
| `StartProductionServerOptions`         | Options accepted by start production server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)               |
| `StartServerOptions`                   | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)                           |
| `StartVeryfrontServerOptions`          | Options accepted by start veryfront server.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `VeryfrontHandler`                     | Web API request handler with WebSocket upgrade and HMR helpers.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)                           |
| `VeryfrontServer`                      | Running server instance with lifecycle controls.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)                           |
| `VeryfrontServiceServer`               | Public API contract for veryfront service server.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `VeryfrontServiceServerFetch`          | Public API contract for veryfront service server fetch.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `VeryfrontServiceServerLogger`         | Public API contract for veryfront service server logger.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `VeryfrontServiceServerModule`         | Public API contract for veryfront service server module.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `VeryfrontServiceServerModuleResponse` | Response payload for veryfront service server module.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `VeryfrontServiceServerRuntime`        | Public API contract for veryfront service server runtime.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |
| `VeryfrontServiceServerRuntimeKind`    | Public API contract for veryfront service server runtime kind.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)                  |

### Constants

| Name                                  | Description                                                                                 | Source                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `defaultDistributedCacheInitializers` | Default wiring of distributed-cache initializers, assembled at the server composition root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/distributed-cache-initializers.ts) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/server/http-broker`

```ts
import {
  connectExecutorTransport,
  createHostedExecutorAllocatorClient,
  createHostedHttpBroker,
} from "veryfront/server/http-broker";
```

#### Functions

| Name                                  | Description                                                                                                                                                                                                                                                                                                                                                      | Source                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `connectExecutorTransport`            | Node-only TLS 1.3 PSK. No certificate fallback, session reuse, or reconnect.                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/executor-node-transport.ts)    |
| `createHostedExecutorAllocatorClient` | Trusted broker client for the operator's dedicated TLS endpoint. Each call reads the rotated Pod-bound token. No redirects, automatic POST retries, arbitrary headers, application credentials, or ambient gateway fallback. The returned promise retains raw token-read and socket ownership; the session supplies prompt cancellation notification separately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/executor-allocator-client.ts)  |
| `createHostedHttpBroker`              | One HTTP invocation per existing allocator session, with no shared-host fallback.                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-broker.ts) |

#### Types

| Name                              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ConnectExecutorTransportOptions` |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/executor-node-transport.ts)     |
| `HostedHttpIngressOptions`        | Host-owned ingress composition, absent by default and never read from project configuration. Proxy mode must have host project execution disabled. Complete project, immutable release, and named environment identities are required; preview branches and failed resolution return a non-cacheable project-execution-unavailable response without host execution fallback. Control-plane routes retain their existing handlers. Preview mode, Markdown preview, component snippets and WebSocket upgrades, including preview HMR, are unsupported under isolation and refused. The installed application handles its own authentication, CORS and middleware. Source publication, resolver authorization and executor deployment remain caller prerequisites. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-ingress.ts) |
| `HostedHttpInput`                 | Trusted ingress authority; none of these values are inferred from HTTP headers or URLs. `projectTracing` binds collector settings to the installed project/environment and imports executor spans under the broker's request parent. Collector credentials stay on the broker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-broker.ts)  |
| `HostedHttpRequestAuthority`      | Trusted edge selection. The resolver must authorize these values against the source API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-ingress.ts) |

### `veryfront/server/http-host`

```ts
import {
  createHostedHttpComposition,
  createRefreshingSourceRecordLookup,
  detectHostedHttpRuntime,
} from "veryfront/server/http-host";
```

#### Components

| Name                        | Description                                                                                   | Source                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `HOSTED_HTTP_ISOLATION_ENV` | Host flag that enables isolated hosted HTTP execution. Default off. Node.js 22 or newer only. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-flag.ts) |

#### Functions

| Name                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Source                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `createHostedHttpComposition`        | Compose the hosted HTTP allocator client, TLS transport, broker, resolver and ingress from host configuration only. Node.js 22 or newer only: on any other runtime it refuses to start rather than serve without isolation. Refuses to start while the shared host-execution override is set. The broker token file is read on every allocator call so rotation applies. The source records file is read at startup and again at most once a minute, so a newly published release is refused for up to one minute and a broken file refuses every release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |
| `createRefreshingSourceRecordLookup` | Serve tenant-source records from a host file that is read again at most once per refresh interval. Until the first lookup after the interval, releases published since the last read are refused. A failed read or parse refuses every lookup until a later read succeeds; stale records are never served after a failed read.                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |
| `detectHostedHttpRuntime`            | The allocator client and the TLS pre-shared-key transport need Node.js 22 or newer. Deno, including the compiled Deno binary, and Bun are unsupported.                                                                                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |
| `isHostedHttpIsolationEnabled`       | Read the hosted HTTP isolation flag from the host environment, excluding project env files. Unset, `0`, `false`, `no` and `off` are off; `1`, `true`, `yes` and `on` are on. Any other value throws, so a misspelled flag never silently leaves isolation off.                                                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-flag.ts)        |
| `readHostedHttpCompositionConfig`    | Read hosted HTTP settings from the host environment, excluding project env files. Returns undefined when the flag is unset or off. An unrecognized flag value or an incomplete configuration is a startup error, never a silent fallback.                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |
| `readHostFilePrefix`                 | Read at most `maxBytes + 1` bytes of a host file, so an oversized file is detected without loading it whole.                                                                                                                                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |
| `settleWithin`                       | Settle with `work`, or reject when `signal` aborts or `timeoutMs` passes. On rejection `work` is detached, so a read that never settles cannot hold its caller.                                                                                                                                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |

#### Types

| Name                          | Description                                                                      | Source                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `HostedHttpComposition`       | Hosted HTTP ingress options and the owner of their executor broker.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |
| `HostedHttpCompositionConfig` | Host-owned settings, read once from the host process environment.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |
| `HostedHttpRuntimeSupport`    | Whether this process can run the hosted HTTP host, and how to name it in errors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-composition.ts) |

### `veryfront/server/http-resolver`

```ts
import {
  buildHostedHttpGenerationBindingInput,
  createHostedHttpResolver,
  createHostedHttpSourceRecordLookup,
} from "veryfront/server/http-resolver";
```

#### Functions

| Name                                    | Description                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `buildHostedHttpGenerationBindingInput` | Derive the authorized parts of a render generation binding from one resolved input. The digest-pinned tenant-source image is the source snapshot identity. Framework, runtime, dependency, artifact and execution-policy identities come from the image receipt and operator policy, which this resolver does not observe.                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-resolver.ts) |
| `createHostedHttpResolver`              | Build the hosted HTTP `resolve()` callback. Each call authorizes the project, its slug, the named environment and its active release with the request's source token, binds the published tenant-source image to that exact project release, and then reads the authorized project environment. Any mismatch rejects; the ingress turns rejection into a non-cacheable unavailable response with no host execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-resolver.ts) |
| `createHostedHttpSourceRecordLookup`    | Serve publication records produced by the tenant-source lookup from a host-owned snapshot. Records are indexed by exact project and release; differing records for one release are refused. The resolver binds `image` to the authorized project release, and the executor session refuses an allocation whose running image differs from that digest.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-resolver.ts) |

#### Types

| Name                               | Description                                                                                     | Source                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `HostedHttpGenerationBindingInput` | Immutable generation identity inputs known after authorization, for generation-bound executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-resolver.ts) |
| `HostedHttpResolverApi`            | Veryfront API reads, each authenticated with the request's source token.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-resolver.ts) |
| `HostedHttpResolverOptions`        |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/hosted-http-resolver.ts) |

### `veryfront/server/http-runtime`

```ts
import {
  createExecutorHttpApplicationRuntime,
  getExecutorHttpApplicationConfigurationSchema,
} from "veryfront/server/http-runtime";
```

#### Functions

| Name                                   | Description                                                                                                                                                                                                                                                                                                               | Source                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createExecutorHttpApplicationRuntime` | Image-owned application factory for startExecutorRuntimeEntrypoint's HTTP hook. Call only after its owner/source gate succeeds, inside the isolated process. The installation owns operation settlement; the allocator owns process exit. This factory retires bootstrap resources and does not itself provide a sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/application-runtime.ts) |

#### Types

| Name                                   | Description | Source                                                                                                                |
| -------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `ExecutorHttpApplicationConfiguration` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/application-configuration.ts) |
| `ExecutorHttpApplicationOptions`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/application-runtime.ts)       |

#### Constants

| Name                                            | Description                                                           | Source                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `getExecutorHttpApplicationConfigurationSchema` | Project-authorized snapshot. Collector settings remain on the broker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/isolated-http/application-configuration.ts) |
