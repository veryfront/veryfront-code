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

## Enable Node.js WebSocket upgrades

Install the explicit Node.js transport extension:

```bash
deno add npm:@veryfront/ext-node-websocket-ws
```

Add it to `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extNodeWebSocketWs from "@veryfront/ext-node-websocket-ws";

export default defineConfig({
  extensions: [extNodeWebSocketWs()],
});
```

Restart the Node.js server after changing the configuration. HTTP serving does
not require this extension. Without it, Node.js WebSocket upgrades fail closed
with an error that names the required package.

## First-party extension areas

| Area          | Example package                              | Contract family   |
| ------------- | -------------------------------------------- | ----------------- |
| Auth          | `@veryfront/ext-auth-jwt`                    | `AuthProvider`    |
| Cache         | `@veryfront/ext-cache-redis`                 | `TokenCacheStore` |
| Content       | `@veryfront/ext-content-mdx`                 | content parsing   |
| CSS           | `@veryfront/ext-css-tailwind`                | CSS processing    |
| Database      | `@veryfront/ext-db-sqlite`                   | database access   |
| LLM           | `@veryfront/ext-llm-openai`                  | model providers   |
| Observability | `@veryfront/ext-observability-opentelemetry` | telemetry         |
| Parser        | `@veryfront/ext-parser-babel`                | parsing           |
| Sandbox       | `@veryfront/ext-sandbox-shell-tools`         | sandbox tools     |
| Schema        | `@veryfront/ext-schema-zod`                  | schema validation |
| WebSocket     | `@veryfront/ext-node-websocket-ws`           | Node.js transport |

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
  matching consumer. For example, setting `CACHE_TYPE=extension` lets the proxy
  use a registered `TokenCacheStore` to share OAuth tokens across processes
  without a core Redis dependency.
- If the factory throws during setup, the dev server prints the setup error
  with the extension name. Fix the error and reload.
