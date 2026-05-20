---
title: "Create a project"
description: "Scaffold a new Veryfront project from a template and run it locally."
order: 2
---

Scaffold a new Veryfront project from a template, then run it locally on the dev server. This is the second step in the Getting Started flow, between [Installation](./installation.md) and [Create an agent](./create-an-agent.md).

## Prerequisites

- The Veryfront CLI installed (see [Installation](./installation.md)).
- A terminal in which you can run `veryfront init`.

## Scaffold

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

## Run the dev server

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

## Verify it worked

`veryfront dev` prints `Ready on http://localhost:3000`. Open the URL: the template's home page should render, and saving any source file should hot-reload the browser within a second.

## Next

- [Create an agent](./create-an-agent.md): define an agent and expose it as a streaming chat endpoint
- [Create an API](./create-an-api.md): add an HTTP endpoint to the project
- [Create a frontend](./create-a-frontend.md): add a new page

## Related

- [Project structure](./project-structure.md): the file conventions used by `veryfront init`
- [Configuration](./configuration.md): customize `veryfront.config.ts`
- [Coding agents](./coding-agents.md): drive the project from Claude Code, Cursor, or Codex
