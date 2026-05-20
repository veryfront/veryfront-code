---
title: "Quickstart"
description: "Create and run a Veryfront project in under 2 minutes."
order: 2
---

Scaffold a Veryfront app, run it locally, and deploy it. The default deploy target is Veryfront Cloud. The same build can be self-hosted on other infrastructure. The npm package, CLI, and import name are all `veryfront`.

## Prerequisites

- The current Node.js LTS, with `npm`, `pnpm`, or `yarn` on your PATH.
- A terminal in which you can run global `npm install` (use `npx veryfront` if
  global installs aren't possible).

## Install

```bash
npm install -g veryfront
```

## Create a project

```bash
veryfront init test-app
cd test-app
```

The CLI walks you through template selection. The current templates are:

| Template ID          | Label              | What you get                       |
| -------------------- | ------------------ | ---------------------------------- |
| `minimal`            | Minimal            | Blank canvas, no extras            |
| `ai-agent`           | AI Agent           | Agent + chat UI + streaming        |
| `docs-agent`         | Docs Agent         | Document Q&A with source citations |
| `agentic-workflow`   | Agentic Workflow   | Steps + approvals + parallelism    |
| `multi-agent-system` | Multi-Agent System | Agents that delegate to each other |
| `coding-agent`       | Coding Agent       | AI code assistant with file tools  |
| `saas-starter`       | SaaS Starter       | Auth + chat + per-user memory      |

To skip the prompt and pick a template up front, pass `--template`:

```bash
veryfront init test-app --template ai-agent
```

## Start the dev server

```bash
veryfront dev
```

Open [http://localhost:3000](http://localhost:3000). Changes to any file reload instantly.

## Project overview

After `init` with the `minimal` template, your project looks like this:

```
test-app/
  app/
    layout.tsx      # Root layout wrapping all pages
    page.tsx        # Home page (/)
    about/
      page.mdx      # /about (MDX page)
  package.json
  README.md
```

If you picked the `ai-agent` template, you also get:

```
test-app/
  agents/
    assistant.ts    # AI agent definition
  tools/
    calculator.ts   # Tool the agent can call
  app/
    layout.tsx
    page.tsx        # Chat UI
    api/
      ag-ui/
        route.ts    # AG-UI streaming chat endpoint
```

Pages live in `app/`. Agents, tools, prompts, and workflows live at the project root: they're auto-discovered by the framework.

## Build for production

```bash
veryfront build
veryfront start
```

## Deploy

```bash
veryfront deploy
```

Your site is live at `https://<slug>.production.veryfront.com`.

To deploy somewhere else, run `veryfront build` and ship the build output to your own host.

## Verify it worked

`veryfront dev` prints `Ready on http://localhost:3000`. Open the URL: the template's home page should render, and saving any source file should hot-reload the browser within a second.

## Next

- [Project structure](./project-structure.md): understand the full directory layout
- [API reference](../reference/README.md): complete API documentation

## Related

- [Pages and routing](./pages-and-routing.md): file-based routing and layouts
- [Agents](./agents.md): create your first AI agent
- [API routes](./api-routes.md): backend HTTP handlers
- [Coding agents](./coding-agents.md): drive the project from Claude Code, Cursor, or Codex
