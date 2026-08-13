---
title: "Getting started"
sidebarTitle: "Overview"
description: "Build and run your first Veryfront app locally."
order: 0
---

Veryfront Code is an Apache-2.0 open-source framework. It works as a standalone
framework and does not require a Veryfront account or Veryfront Cloud.

Choose the path that matches your goal:

| Path | Use it when |
| --- | --- |
| Local development | You want to build, run, and evaluate an app on your machine. |
| Self-host | You want to deploy the app in your own cloud, private network, or on-premises environment. |
| Veryfront Cloud | You want managed previews, deployment, AI Gateway, durable execution, or Studio. |

Every agent needs access to model inference. Use a direct provider API key, an
OpenAI-compatible inference service, or a built-in local model. Your inference
choice is independent of where you develop or deploy the app.

## Before you start

Be familiar with TypeScript and React. Have Node.js, Deno, or Bun installed,
plus a code editor and terminal. AI know-how is not required.

## Contents

| Page                                        | Goal                                       |
| ------------------------------------------- | ------------------------------------------ |
| [Quickstart](./quickstart.md)               | Build and evaluate the first app locally.  |
| [Installation](./installation.md)           | Install the CLI or framework.              |
| [Create project](./create-project.md)       | Scaffold and run a project.                |
| [Create agent](./create-agent.md)           | Define and invoke an agent.                |
| [Create API](./create-api.md)               | Expose the agent route.                    |
| [Create frontend](./create-frontend.md)     | Add a chat UI for the agent.               |
| [Coding agents](../guides/coding-agents.md) | Connect an editor agent to the dev server. |
| [Deploy project](./deploy-project.md)       | Self-host or use Veryfront Cloud.          |

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
