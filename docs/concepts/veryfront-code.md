---
title: "Veryfront Code"
description: "What Veryfront Code is, which primitives it provides, and how its public docs fit together."
order: 1
---

Veryfront Code is a Deno-first, full-stack framework for building AI-powered
applications and agents in TypeScript and React. It treats agents, workflows,
tools, pages, APIs, and rendering as framework primitives with shared project
conventions.

## Primitive set

| Area                 | What it gives you                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Pages and APIs       | React routes, MDX pages, data loading, and HTTP handlers.                                                          |
| Agents and tools     | Model reasoning, tool calling, memory, AG-UI streaming, and chat UI.                                               |
| Workflows and jobs   | Durable multi-step execution, background tasks, cron jobs, and run history.                                        |
| Integrations and MCP | Connector-backed tools, OAuth, prompts, resources, and assistant-facing protocol surfaces.                         |
| Extensions           | Runtime contracts for providers, schema validation, bundling, content, auth, cache, observability, and sandboxing. |

## Documentation map

| Section                                        | Use it when                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| [Getting Started](../getting-started/overview.md) | You are installing Veryfront Code or building your first project.             |
| [Guides](../guides/overview.md)                   | You need to complete a specific task in an existing project.                  |
| [Concepts](./overview.md)                      | You need context, terminology, and mental models before choosing an approach. |
| [API reference](../api-reference/overview.md)     | You need exact imports, exported names, types, and examples.                  |

## Related

- [Runtime primitives](./runtime-primitives.md): how the core primitives differ.
- [Project conventions](./project-conventions.md): how Veryfront projects are
  organized.
- [Quickstart](../getting-started/quickstart.md): build the first app.
