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

Extension factories are executable configuration. They can be enabled from
`veryfront.config.ts` in local development and standalone deployments, where
configuration loads as a normal module. Shared hosted and proxy runtimes use
declarative configuration: project config cannot import an extension package or
execute a factory there. Provision hosted runtime capabilities through the
platform instead. See
[Shared hosted runtimes](./configuration.md#shared-hosted-runtimes).

## Enable an extension

Add extension factories to `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extRedis from "@veryfront/ext-redis";

export default defineConfig({
  extensions: [
    extRedis(),
  ],
});
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
with `503`. CSRF protection remains a separate check and must stay enabled for
the action endpoint.

Server Action arguments must be JSON-compatible: finite primitives, dense
arrays, and plain records. Convert `FormData`, class instances, dates, and
other application objects before calling an action. See the
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

Node.js WebSocket upgrades require the explicit `ws` transport extension. Add
the package:

```bash
deno add npm:@veryfront/ext-node-websocket-ws
```

Then enable it in `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extNodeWebSocketWs from "@veryfront/ext-node-websocket-ws";

export default defineConfig({
  extensions: [extNodeWebSocketWs()],
});
```

Restart the server after changing the configuration. If you use
`createHandler()` with an external Node HTTP server, call
`handler.upgrade(server)` only after the handler is ready. Veryfront does not
auto-load a WebSocket implementation: when the extension is absent, normal
HTTP serving remains available and an attempted Node WebSocket upgrade fails
closed with a diagnostic naming `@veryfront/ext-node-websocket-ws`.

## First-party extension areas

| Area                       | Example package                              | Contract family               |
| -------------------------- | -------------------------------------------- | ----------------------------- |
| Auth                       | `@veryfront/ext-auth-jwt`                    | `AuthProvider`                |
| Proxy cache                | `@veryfront/ext-cache-redis`                 | `TokenCacheStore`             |
| Distributed infrastructure | `@veryfront/ext-redis`                       | `DistributedRuntimeProvider`  |
| Content                    | `@veryfront/ext-content-mdx`                 | content parsing               |
| CSS                        | `@veryfront/ext-css-tailwind`                | CSS processing                |
| Database                   | `@veryfront/ext-db-sqlite`                   | database access               |
| LLM                        | `@veryfront/ext-llm-openai`                  | model providers               |
| Node.js WebSocket          | `@veryfront/ext-node-websocket-ws`           | `NodeWebSocketServerProvider` |
| Observability              | `@veryfront/ext-observability-opentelemetry` | telemetry                     |
| Parser                     | `@veryfront/ext-parser-babel`                | parsing                       |
| Sandbox                    | `@veryfront/ext-sandbox-shell-tools`         | sandbox tools                 |
| Schema                     | `@veryfront/ext-schema-zod`                  | schema validation             |

Veryfront applies explicit disable directives and higher-priority project
overrides before importing optional first-party built-ins. A package that is
not installed is skipped. An installed package that fails to load, returns an
invalid extension, or leaves a required contract unavailable stops activation;
the currently active extension generation remains in service until the
replacement passes preflight.

## Verify it worked

Restart `veryfront dev` after editing `veryfront.config.ts`:

- The dev log should print a setup line for each loaded extension.
- Any contract the extension provides should now be resolvable through the
  matching consumer (for example, a `CacheStore` extension lets cache-aware
  code skip its local fallback).
- If the factory throws during setup, the dev server prints the setup error
  with the extension name. Fix the error and reload.
