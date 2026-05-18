---
title: "Quickstart"
description: "Create and run a Veryfront project in under 2 minutes."
order: 1
---

# Quickstart

Create and run a Veryfront project in under 2 minutes.

The flow below starts locally and ends with an optional Veryfront Cloud deploy. The same project can also run self-hosted or on other infrastructure.
The npm package, CLI, and import name remain `veryfront`.

## Prerequisites

- Node.js 18 or later, with `npm`, `pnpm`, or `yarn` on your PATH.
- A terminal in which you can run global `npm install` (use `npx veryfront` if
  global installs aren't possible).

## Install

```bash
npm install -g veryfront
```

## Create a project

```bash
veryfront init my-app
cd my-app
```

The CLI walks you through template selection:

- **AI Chatbot**: Agent + chat UI + streaming
- **Chat with Your Docs**: RAG with source citations
- **Multi-Agent System**: Agents that delegate to each other
- **AI Workflow Pipeline**: Steps + approvals + parallelism
- **Coding Agent**: Claude Code-powered code assistant
- **AI SaaS**: Auth + chat + per-user memory

## Start the dev server

```bash
veryfront dev
```

Open [http://localhost:3000](http://localhost:3000). Changes to any file reload instantly.

## Project overview

After `init`, your project looks like this:

```
my-app/
  app/
    layout.tsx      # Root layout wrapping all pages
    page.tsx        # Home page (/)
  package.json
```

If you picked the **AI Chatbot** template, you also get:

```
my-app/
  agents/
    assistant.ts    # AI agent definition
  tools/
    calculator.ts   # Tool the agent can call
  app/
    layout.tsx
    page.tsx        # Chat UI
    api/
      chat/
        route.ts    # Streaming chat endpoint
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

Deploys to Veryfront Cloud, the recommended managed deployment path. Your site is live at `https://<slug>.production.veryfront.com`.

If you prefer a different deployment target, run `veryfront build` and deploy the generated output using your own infrastructure.

## Verify it worked

After `veryfront dev`, the terminal prints `Ready on http://localhost:3000`.
Open that URL: the template's home page should render and a `Cmd+S` save in
any source file should hot-reload within a second.

## Next

- [Project structure](./project-structure.md): understand the full directory layout
- [API reference](../reference/index.md): complete API documentation

## Related

- [Pages and routing](./pages-and-routing.md): file-based routing and layouts
- [Agents](./agents.md): create your first AI agent
- [API routes](./api-routes.md): backend HTTP handlers
