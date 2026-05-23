---
title: "Project conventions"
description: "Why Veryfront Code separates routes, AI primitives, shared code, static content, and configuration."
order: 3
---

Veryfront projects keep user-facing routes in router directories and keep AI
primitives at the project root. This keeps application surfaces visible without
hiding agents, tools, workflows, prompts, resources, and skills inside route
trees.

## Directory roles

| Area                                                                   | Role                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| `app/` or `pages/`                                                     | Pages, layouts, and API routes.                     |
| `agents/`, `tools/`, `workflows/`, `prompts/`, `resources/`, `skills/` | Auto-discovered AI and MCP primitives.              |
| `components/`                                                          | Shared React components.                            |
| `lib/`                                                                 | Shared project utilities and business logic.        |
| `content/`                                                             | Static content such as MDX, JSON, or YAML.          |
| `public/`                                                              | Static assets served from the root path.            |
| `veryfront.config.ts`                                                  | Framework configuration and extension registration. |

## Why primitives live at the root

Agents, tools, workflows, prompts, resources, and skills are not routes. They
can be invoked from pages, API routes, jobs, workflows, MCP servers, or agent
services. Keeping them at the root reflects that broader scope and makes
auto-discovery predictable.

Route files still decide how users and HTTP clients enter the system. Primitive
files define capabilities that routes and runtime services can use.

## Related

- [Project structure](../guides/project-structure.md): place files in a project.
- [Configuration](../guides/configuration.md): customize discovery and runtime
  settings.
- [`veryfront`](../api-reference/veryfront/index.md): core framework API
  reference.
