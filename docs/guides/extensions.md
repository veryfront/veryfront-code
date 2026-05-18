---
title: "Extensions"
description: "Understand how extensions add focused capabilities to Veryfront."
order: 28
---

# Extensions

Extensions add focused capabilities to Veryfront through contract implementations. Use this overview to choose the right extension path. Use [Extension authoring](./extension-authoring.md) to write one, [Extension lifecycle](./extension-lifecycle.md) to understand discovery and loading, [Extension testing](./extension-testing.md) to verify behavior, and [Extension publishing](./extension-publishing.md) to package one for reuse.

## Prerequisites

- A Veryfront project with `veryfront.config.ts`.
- For a first-party extension: the matching package installed.
- For a local extension: a folder under `extensions/` with a default-exported
  factory (see [Extension authoring](./extension-authoring.md)).

## Concepts

| Term       | Meaning                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| Contract   | A TypeScript interface for a capability, such as `CacheStore` or `AuthProvider`.    |
| Extension  | A package or local module that implements one or more contracts.                    |
| Factory    | A function that accepts optional config and returns an extension object.            |
| Capability | A declared resource requirement such as filesystem, network, or environment access. |

## Enable an extension

Add extension factories to `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extRedis from "@veryfront/ext-cache-redis";

export default defineConfig({
  extensions: [
    extRedis({ url: "redis://localhost:6379", prefix: "myapp:" }),
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

## First-party extension areas

| Area          | Example package                              | Contract family   |
| ------------- | -------------------------------------------- | ----------------- |
| Auth          | `@veryfront/ext-auth-jwt`                    | `AuthProvider`    |
| Cache         | `@veryfront/ext-cache-redis`                 | `CacheStore`      |
| Content       | `@veryfront/ext-content-mdx`                 | content parsing   |
| CSS           | `@veryfront/ext-css-tailwind`                | CSS processing    |
| Database      | `@veryfront/ext-db-sqlite`                   | database access   |
| LLM           | `@veryfront/ext-llm-openai`                  | model providers   |
| Observability | `@veryfront/ext-observability-opentelemetry` | telemetry         |
| Parser        | `@veryfront/ext-parser-babel`                | parsing           |
| Sandbox       | `@veryfront/ext-sandbox-shell-tools`         | sandbox tools     |
| Schema        | `@veryfront/ext-schema-zod`                  | schema validation |

## Verify it worked

Restart `veryfront dev` after editing `veryfront.config.ts`:

- The dev log should print a setup line for each loaded extension.
- Any contract the extension provides should now be resolvable through the
  matching consumer (for example, a `CacheStore` extension lets cache-aware
  code skip its local fallback).
- If the factory throws during setup, the dev server prints the setup error
  with the extension name. Fix the error and reload.

## Next

- [Extension authoring](./extension-authoring.md): write factories, contracts, and capabilities
- [Extension lifecycle](./extension-lifecycle.md): understand discovery, ordering, presets, and teardown
- [Extension testing](./extension-testing.md): test extension factories and contract implementations
- [Extension publishing](./extension-publishing.md): publish reusable extension packages

## Related

- [`veryfront/extensions`](../reference/extensions.md): extension API reference
- [Project structure](./project-structure.md): where local extensions live
