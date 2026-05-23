---
title: "Framework extensions"
description: "How extensions add replaceable runtime infrastructure to Veryfront Code."
order: 7
---

An extension owns replaceable runtime infrastructure. It can provide a model
provider, cache store, auth provider, parser, database adapter, observability
adapter, content pipeline, schema validator, or sandbox implementation.

Extensions exist so application code can depend on contracts instead of concrete
packages. A project can swap a local cache for Redis, a local parser for another
parser, or one model provider for another without changing the code that uses
the capability.

Extensions are framework primitives because they change how the runtime is
assembled. They are not app features. They provide infrastructure that apps,
agents, tools, workflows, and other primitives can use.

## Characteristics

- A factory accepts configuration and returns an extension.
- A contract describes the capability consumers depend on.
- A capability declares runtime needs such as filesystem, network, environment,
  process, or sandbox access.
- Setup opens resources and registers contracts.
- Teardown releases resources during shutdown or reload.
- Presets group extensions that usually load together.

## Boundary

Veryfront discovers extension factories, expands presets, orders providers
before consumers, runs setup, serves the app, and runs teardown in reverse order.
This lifecycle gives extensions a predictable place to open and release runtime
resources.

Contracts are the important boundary. Consumers depend on contracts, not on a
specific package implementation. That keeps app code stable when a project swaps
a local adapter for a hosted or third-party implementation.

## Common extension areas

| Area          | What it provides                         |
| ------------- | ---------------------------------------- |
| Auth          | User or request identity.                |
| Cache         | Shared cache storage.                    |
| Content       | Content loading and parsing.             |
| CSS           | CSS processing.                          |
| Database      | Database access.                         |
| LLM           | Model provider access.                   |
| Observability | Tracing, metrics, logs, and diagnostics. |
| Parser        | Source parsing and transforms.           |
| Sandbox       | Isolated execution support.              |
| Schema        | Runtime schema validation.               |

## Wrong fit

Do not create an extension for code that belongs to one app. Use an extension
when a runtime capability should be packaged, configured, and reused behind a
contract.

For implementation steps, see [Extensions](../guides/extensions.md).
