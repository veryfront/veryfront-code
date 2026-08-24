---
title: "Extensions"
description: "Understand how extensions add focused capabilities to Veryfront."
order: 38
---

Extensions are factories that add focused capabilities to a Veryfront project:
a cache store, an auth provider, a database adapter, a model provider, or an
MDX content pipeline.

For the concepts behind factories, contracts, capabilities, setup, and teardown,
see [Framework extensions](../concepts/framework-extensions.md).

## Prerequisites

- A Veryfront project with `veryfront.config.ts`.
- For a first-party extension: the matching package installed.
- For a local extension: a folder under `extensions/` with a default-exported
  factory (see [Extension authoring](./extension-authoring.md)).

## Where extensions run

Extensions run wherever you run the project: `veryfront dev`, `veryfront
start`, and any runtime you host yourself.

Veryfront Cloud is the exception. It reads a project's configuration file as
data rather than importing it, so a configuration file that imports an
extension factory cannot be evaluated there. `veryfront deploy` refuses such a
configuration before it creates a release, and names the line it refused. Keep
a configuration file that Veryfront Cloud serves to literals and the
`defineConfig`, `defineConfigWithEnv`, `getEnv` and `mergeConfigs` helpers.

## Enable an extension

Add extension factories to `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extRedis from "@veryfront/ext-cache-redis";

export default defineConfig({
  extensions: [
    extRedis(),
  ],
});
```

Configure the provider through its environment boundary before startup:

```bash
REDIS_URL=redis://localhost:6379 REDIS_PREFIX=myapp: veryfront dev
```

Use a local extension the same way:

```ts
import { defineConfig } from "veryfront";
import memoryCache from "./extensions/memory-cache/src/index.ts";

export default defineConfig({
  extensions: [
    memoryCache({ maxSize: 500 }),
  ],
});
```

Verify the extension loads by running the dev server:

```bash
veryfront dev
```

If the extension factory throws during setup, the dev server reports the setup error. For local extensions, edit the extension source and save `veryfront.config.ts` to force reload during development.

## Enable legacy decorator metadata

The default esbuild transform supports decorator syntax but does not emit
TypeScript runtime type metadata. Install the explicit SWC bundler extension
when class-validator, TypeORM, or a dependency-injection library needs
`design:type`, `design:paramtypes`, or `design:returntype`:

```bash
npm install @veryfront/ext-bundler-swc
```

Select it in executable local or standalone configuration:

```ts
import { defineConfig } from "veryfront";
import extSwc from "@veryfront/ext-bundler-swc";

export default defineConfig({
  extensions: [extSwc()],
});
```

Enable legacy decorators and metadata in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

The extension follows inherited TypeScript configuration and initializes the
reflection runtime before decorated modules are evaluated. Without the
extension, esbuild remains the default and ignores `emitDecoratorMetadata`.
Projects that use standard decorators or validation libraries without runtime
type reflection do not need the extension.

Isolated route preparation follows inherited configuration only inside the
project boundary, including project-owned `node_modules`. Copy an external
workspace configuration into the project before using it in an isolated
runtime. Trusted host execution can follow configuration outside the project.

Enabling `experimentalDecorators` routes local Deno API modules through
per-route SWC bundles. Separate route bundles do not share module-level state
from a common project import. The extension reads only the two decorator flags
from TypeScript configuration; other TypeScript emit settings are not forwarded
to SWC. The active legacy transform rejects source-map requests because it does
not compose SWC and esbuild maps yet. Review the extension package README before
treating module singletons or compiler-specific output as part of your route
contract.

## Authorize React Server Actions

Server Actions require an application-owned authorization provider. Create a
local extension that publishes the provider through the active extension
generation:

```ts
// extensions/server-action-authorization/src/index.ts
import type { Extension } from "veryfront/extensions";
import {
  createRscActionAuthorizationProvider,
  RscActionAuthorizationProviderName,
  type RscActionAuthorize,
} from "veryfront/extensions/auth";

export default function serverActionAuthorization(
  authorize: RscActionAuthorize,
): Extension {
  return {
    name: "server-action-authorization",
    version: "1.0.0",
    capabilities: [],
    contracts: {
      provides: [RscActionAuthorizationProviderName],
    },
    setup(context) {
      context.provide(
        RscActionAuthorizationProviderName,
        createRscActionAuthorizationProvider(authorize),
      );
    },
  };
}
```

Keep application authentication and policy in application code. The request
snapshot is bodyless; make the decision from authenticated request metadata,
the action ID, project identity, and the detached JSON-compatible arguments:

```ts
// lib/authorize-server-action.ts
import type { RscActionAuthorize } from "veryfront/extensions/auth";
import { authenticateServerActionRequest } from "./session-policy.ts";

export const authorizeServerAction: RscActionAuthorize = async (
  request,
  context,
) => {
  const identity = await authenticateServerActionRequest({
    authorization: request.headers.authorization,
    signal: request.signal,
  });
  return identity !== null && await identity.mayInvoke({
    actionId: context.id,
    args: context.args,
    projectId: context.projectId,
  });
};
```

Enable the extension in executable local or standalone configuration:

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront";
import serverActionAuthorization from "./extensions/server-action-authorization/src/index.ts";
import { authorizeServerAction } from "./lib/authorize-server-action.ts";

export default defineConfig({
  extensions: [serverActionAuthorization(authorizeServerAction)],
});
```

For shared hosted or proxy runtimes, provision the same contract through the
platform-owned extension generation; tenant configuration cannot execute the
factory. Restart or reload, then verify an allowed action succeeds, a policy
denial returns `403`, and removing the provider makes the endpoint fail closed
with `503`. Configure CSRF protection independently through `security.csrf`;
the authorization provider does not enable or replace it.

Server Action arguments must be JSON-compatible: finite primitives, dense
arrays, and plain records. Convert `FormData`, class instances, dates, and
other application objects before calling an action. Each request accepts at
most `RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS` top-level arguments; nested arrays
use the separately documented authorization snapshot bounds. See the
[`veryfront/extensions/auth` reference](../api-reference/veryfront/extensions.md#veryfrontextensionsauth)
for the exact provider DTO, bounds, outcomes, timeout, cancellation, and
generation-retirement behavior.

### Migrate from the legacy Server Action guard

The old import-map override at
`rendering/rsc/server-action-guard.ts` is no longer consulted and its former
default allowed every action. Remove that override, publish
`RscActionAuthorizationProviderName` as shown above, and deploy the provider
with the framework upgrade. Until the active generation owns a valid provider,
Server Action requests intentionally return `503`; there is no core allow-all
fallback.

## Enable Node.js WebSocket upgrades

The standard `veryfront` npm/CLI distribution installs and auto-activates the
Node.js transport extension, including for local HMR. Custom Node service
distributions must install it alongside `veryfront`:

```bash
deno add npm:@veryfront/ext-node-websocket-ws
```

No `veryfront.config.ts` entry is required. To disable the builtin when
WebSocket support is intentionally unavailable, use:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  extensions: [{ name: "ext-node-websocket-ws", enabled: false }],
});
```

HTTP serving does not require the provider. Without it, Node.js WebSocket
upgrades fail closed with an error that names the required package.

## First-party extension areas

| Area          | Example package                                        | Contract family   |
| ------------- | ------------------------------------------------------ | ----------------- |
| Auth          | `@veryfront/ext-auth-jwt`                              | `AuthProvider`    |
| Build         | `@veryfront/ext-bundler-swc`                           | `Bundler`         |
| Cache         | `@veryfront/ext-cache-redis`                           | `TokenCacheStore` |
| Content       | `@veryfront/ext-content-mdx`                           | content parsing   |
| CSS           | `@veryfront/ext-css-tailwind`                          | CSS processing    |
| Database      | `@veryfront/ext-db-sqlite`                             | database access   |
| LLM           | `@veryfront/ext-llm-openai`, `@veryfront/ext-llm-onnx` | model providers   |
| Observability | `@veryfront/ext-observability-opentelemetry`           | telemetry         |
| Parser        | `@veryfront/ext-parser-babel`                          | parsing           |
| Sandbox       | `@veryfront/ext-sandbox-shell-tools`                   | sandbox tools     |
| Schema        | `@veryfront/ext-schema-zod`                            | schema validation |
| WebSocket     | `@veryfront/ext-node-websocket-ws`                     | Node.js transport |

Veryfront applies explicit disable directives and higher-priority project
overrides before importing optional first-party built-ins. A package that is
not installed is skipped. An installed package that fails to load, returns an
invalid extension, or leaves a required contract unavailable stops activation;
the currently active extension generation remains in service until the
replacement passes preflight.

## Verify it worked

Restart `veryfront dev` after changing extension configuration:

- The dev log should print a setup line for each loaded extension.
- Any contract the extension provides should now be resolvable through the
  matching consumer. For example, setting `CACHE_TYPE=extension` lets the proxy
  use a registered `TokenCacheStore` to share OAuth tokens across processes
  without a core Redis dependency.
- If the factory throws during setup, the dev server prints the setup error
  with the extension name. Fix the error and reload.
