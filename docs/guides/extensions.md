---
title: "Extensions"
description: "Understand how extensions add focused capabilities to Veryfront."
order: 28
---

# Extensions

Extensions add focused capabilities to Veryfront through contract implementations. Use this overview to choose the right extension path. Use [Extension authoring](./extension-authoring.md) to write one, [Extension lifecycle](./extension-lifecycle.md) to understand discovery and loading, [Extension testing](./extension-testing.md) to verify behavior, and [Extension publishing](./extension-publishing.md) to package one for reuse.

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

## Next

- [Extension authoring](./extension-authoring.md): write factories, contracts, and capabilities
- [Extension lifecycle](./extension-lifecycle.md): understand discovery, ordering, presets, and teardown
- [Extension testing](./extension-testing.md): test extension factories and contract implementations
- [Extension publishing](./extension-publishing.md): publish reusable extension packages

## Related

- [`veryfront/extensions`](../reference/extensions.md): extension API reference
- [Project structure](./project-structure.md): where local extensions live
