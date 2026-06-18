---
title: "Getting started"
sidebarTitle: "Overview"
description: "Build and deploy your first Veryfront app."
order: 0
---

## Before you start

Be familiar with TypeScript and React. Have Node.js, Deno, or Bun installed,
plus a code editor and terminal. AI know-how is not required.

## Contents

| Page                                        | Goal                                       |
| ------------------------------------------- | ------------------------------------------ |
| [Quickstart](./quickstart.md)               | Build the first app end-to-end.            |
| [Installation](./installation.md)           | Install the CLI or framework.              |
| [Create project](./create-project.md)       | Scaffold and run a project.                |
| [Create agent](./create-agent.md)           | Define and invoke an agent.                |
| [Create API](./create-api.md)               | Expose the agent route.                    |
| [Create frontend](./create-frontend.md)     | Add a chat UI for the agent.               |
| [Coding agents](../guides/coding-agents.md) | Connect an editor agent to the dev server. |
| [Deploy project](./deploy-project.md)       | Build and ship the project.                |

## CLI workflow

Use the CLI for the normal project loop:

```bash
npm create veryfront
cd <PROJECT_NAME>
veryfront dev
```

Use `veryfront generate <type> <name>` to add routes, components, and AI
primitives. Use `veryfront schema --json` when a human or coding agent needs the
current command schema.

## Coding-agent workflow

Starter projects include `AGENTS.md`. Coding agents should read it first, then
connect to the development MCP server started by `veryfront dev` and call
`vf_bootstrap` once at session start. Use
[Coding agents](../guides/coding-agents.md) for Claude Code, Cursor, Codex, and
other MCP-aware clients.
