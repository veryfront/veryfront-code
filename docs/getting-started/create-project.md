---
title: "Create project"
description: "Scaffold a new Veryfront project from a template and run it locally."
order: 3
---

Scaffold a new Veryfront project from a template, then run it locally on the dev
server. This is the second step in the Getting Started flow, between
[Installation](./installation.md) and [Create agent](./create-agent.md).

## Prerequisites

- The Veryfront CLI installed (see [Installation](./installation.md)).
- A terminal in which you can run `veryfront init`.

## Scaffold

```bash
veryfront init test-app
cd test-app
```

The CLI asks which template to use. Choose `minimal` for a blank app or
`ai-agent` when you want an agent and chat route in the scaffold. To skip the
prompt, pass `--template`:

```bash
veryfront init test-app --template ai-agent
```

## Run the dev server

```bash
veryfront dev
```

Open [http://localhost:3000](http://localhost:3000). Changes to any file reload
instantly.

## Inspect the scaffold

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

Pages live in `app/`. The agent template also adds root-level `agents/` and
`tools/` directories. For the convention behind these directories, see
[Project conventions](../concepts/project-conventions.md).

## Verify it worked

`veryfront dev` prints `Ready on http://localhost:3000`. Open the URL: the
template's home page should render, and saving any source file should hot-reload
the browser within a second.

## Next

- [Create agent](./create-agent.md): define an agent and expose it as a
  streaming chat endpoint
- [Create API](./create-api.md): add an HTTP endpoint to the project
- [Create frontend](./create-frontend.md): add a new page

## Related

- [Project structure](../guides/project-structure.md): the file conventions used
  by `veryfront init`
- [Configuration](../guides/configuration.md): customize `veryfront.config.ts`
- [Coding agents](../guides/coding-agents.md): drive the project from Claude
  Code, Cursor, or Codex
