---
title: "Framework overview"
description: "How Veryfront Code combines app surfaces, AI primitives, runtime services, and extensions."
order: 1
---

Veryfront Code is a Deno-first, full-stack framework for building AI-powered
applications and agents in TypeScript and React. It treats agents, workflows,
tools, pages, APIs, and rendering as framework primitives with shared project
conventions.

The framework exists because AI applications need normal app surfaces and AI
runtime surfaces to cooperate. A chat page, an AG-UI route, an agent, a tool, and
a deployment target are separate concerns, but they belong to the same product
and should be discoverable in the same project.

## Primitive set

| Area                 | What it gives you                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Pages and APIs       | React routes, MDX pages, data loading, and HTTP handlers.                                                          |
| Agents and tools     | Model reasoning, tool calling, memory, AG-UI streaming, and chat UI.                                               |
| Workflows and jobs   | Durable multi-step execution, background tasks, cron jobs, and run history.                                        |
| Integrations and MCP | Connector-backed tools, OAuth, prompts, resources, and assistant-facing protocol surfaces.                         |
| Extensions           | Runtime contracts for providers, schema validation, bundling, content, auth, cache, observability, and sandboxing. |

The shared project model matters more than any single primitive. Routes decide
how users and HTTP clients enter the system. Agents, tools, workflows, and jobs
define capabilities that can be reused from those routes or from runtime
services. Extensions provide infrastructure behind contracts so application code
does not need to know which provider, cache, parser, or auth adapter is active.
