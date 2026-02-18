---
title: "Quickstart"
description: "Create and run a Veryfront project in under 2 minutes."
order: 1
---

# Quickstart

Create and run a Veryfront project in under 2 minutes.

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

- **AI Chatbot** — Agent + chat UI + streaming
- **Chat with Your Docs** — RAG with source citations
- **Multi-Agent System** — Agents that delegate to each other
- **AI Workflow Pipeline** — Steps + approvals + parallelism
- **Coding Agent** — Claude Code-powered code assistant
- **AI SaaS** — Auth + chat + per-user memory

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

Pages live in `app/`. Agents, tools, prompts, and workflows live at the project root — they're auto-discovered by the framework.

## Build for production

```bash
veryfront build
veryfront start
```

## Deploy

```bash
veryfront deploy
```

Deploys to Veryfront Cloud. Your site is live at `https://<slug>.veryfront.com`.

## Next

- [Project Structure](./project-structure.md) — understand the full directory layout
- [API Reference](../reference/index.md) — complete API documentation

## Related

- [Pages & Routing](./pages-and-routing.md) — file-based routing and layouts
- [Agents](./agents.md) — create your first AI agent
- [API Routes](./api-routes.md) — backend HTTP handlers
