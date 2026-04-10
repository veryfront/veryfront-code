---
title: "veryfront/provider"
description: "Provider registry for resolving \"provider/model\" strings to framework-compatible model runtimes. Auto-initializes built-in providers from environment variables on first use."
order: 17
---

# veryfront/provider

Provider registry. Maps "provider/model" strings to framework-compatible model runtimes.

Most apps do not need this directly. Omit `model` on `agent()` to follow
runtime defaults, or use `resolveModel()` and `registerModelProvider()` when
you need an explicit provider path.

Use `agent({ resolveModelTransport })` when the missing piece is
request-aware transport behavior such as per-request headers or provider
options. `registerModelProvider()` is still the right tool for static model
runtime registration.

## Import

```ts
import {
  clearModelProviders,
  ensureModelReady,
  getRegisteredModelProviders,
  hasModelProvider,
  registerModelProvider,
  resolveModel,
} from "veryfront/provider";
```

## Examples

### Resolve a model

```ts
import { resolveModel } from "veryfront/provider";

const model = resolveModel("veryfront-cloud/openai/gpt-5.2");
```

## API

### `registerModelProvider(name, factory)`

Register a custom model provider factory for the current project.

This is an advanced interop hook. Prefer built-in providers and `resolveModel()`
unless you need to bridge a custom model runtime. Custom runtimes must expose
the framework generation surface, including `doGenerate()` and `doStream()`.

**Returns:** `void`

### `resolveModel(modelString)`

Resolve a "provider/model" string to a framework-compatible model runtime.

**Returns:** model runtime object

### `hasModelProvider(name)`

Check if a model provider is registered (project-scoped or shared).

**Returns:** `boolean`

### `getRegisteredModelProviders()`

Get list of registered model provider names (project-scoped + shared).

**Returns:** `string[]`

### `clearModelProviders()`

Clear all registered model providers (for testing).

**Returns:** `void`

## Exports

### Functions

| Name                          | Description                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| `clearModelProviders`         | Clear all registered model providers (for testing).                        |
| `ensureModelReady`            | Eagerly verify that the resolved model's runtime is available.             |
| `getRegisteredModelProviders` | Get list of registered model provider names (project-scoped + shared).     |
| `hasModelProvider`            | Check if a model provider is registered (project-scoped or shared).        |
| `registerModelProvider`       | Register a custom model provider factory for the current project.          |
| `resolveModel`                | Resolve a "provider/model" string to a framework-compatible model runtime. |

### Types

| Name                   | Description                          |
| ---------------------- | ------------------------------------ |
| `ModelProviderFactory` | `(modelId: string) => model runtime` |

## Related

- [`veryfront/agent`](./agent.md) — Agents use providers for AI models
