---
title: "Framework conventions"
description: "Veryfront Code uses conventions over configuration."
order: 3
---

Veryfront Code uses file-based routing for app surfaces and auto-discovers
project entities such as agents, skills, tools, workflows, prompts, and
resources. Common project directories keep shared code, content, and assets
predictable.

Conventions reduce configuration by making intent visible in the file tree. A
route file is an entry point. An agent file is a reusable AI capability. A tool
file is a callable operation. Keeping those roles separate lets Veryfront
discover project entities without hiding them inside route trees or central
registries.

## Core idea

The directory name communicates the role. `app/` and `pages/` contain entry
points. `agents/`, `tools/`, `workflows/`, `tasks/`, `prompts/`, `resources/`,
and `skills/` contain reusable capabilities. `veryfront.config.ts` wires
framework behavior and extensions.

## Directory roles

| Area                                                                   | Role                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| `app/` or `pages/`                                                     | Pages, layouts, and API routes.                     |
| `agents/`, `tools/`, `workflows/`, `prompts/`, `resources/`, `skills/` | Auto-discovered AI and MCP primitives.              |
| `components/`                                                          | Shared React components.                            |
| `lib/`                                                                 | Shared project utilities and business logic.        |
| `content/`                                                             | App-owned content files, such as Markdown or data.  |
| `public/`                                                              | Static assets served from the root path.            |
| `veryfront.config.ts`                                                  | Framework configuration and extension registration. |

## Why this matters

Routes are user and HTTP entry points. Auto-discovered entities are capabilities
that routes, jobs, workflows, MCP servers, and agent services can use. This is
why agents, tools, workflows, prompts, resources, and skills live at the project
root instead of under a route directory.

The convention keeps app structure predictable as a project grows. User-facing
surfaces stay in router directories, while reusable capabilities stay visible at
the same level as framework configuration.
