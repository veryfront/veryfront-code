---
title: "Project conventions"
description: "Veryfront Code uses conventions over configuration."
order: 3
---

Veryfront Code uses file-based routing for app surfaces and auto-discovers
project entities such as agents, skills, tools, workflows, prompts, and
resources. Common project directories keep shared code, content, and assets
predictable.

## Directory structure

| Area                                                                   | Role                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| `app/` or `pages/`                                                     | Pages, layouts, and API routes.                     |
| `agents/`, `tools/`, `workflows/`, `prompts/`, `resources/`, `skills/` | Auto-discovered AI and MCP primitives.              |
| `components/`                                                          | Shared React components.                            |
| `lib/`                                                                 | Shared project utilities and business logic.        |
| `content/`                                                             | App-owned content files, such as Markdown or data.  |
| `public/`                                                              | Static assets served from the root path.            |
| `veryfront.config.ts`                                                  | Framework configuration and extension registration. |

## Auto-discovered entities

Put pages and API routes in `app/` or `pages/`. Put agents, tools, workflows,
prompts, resources, and skills in their root directories so Veryfront can
auto-discover them.
