---
title: "Quickstart"
description: "Build your first Veryfront agent app."
order: -1
---

## Prerequisites

- Node.js 22.3 or later.

The examples use `veryfront` commands. If you have not installed the CLI
globally, run them with `npx veryfront@latest ...`.

## Create the app

```bash
npm create veryfront@latest support-agent
cd support-agent
```

The `ai-agent` starter is the default. Pass `-- --template <template>` when you
want a different starting point.

The `ai-agent` template creates a runnable chat app:

```text
support-agent/
  AGENTS.md
  agents/
    assistant.ts
  tools/
    calculator.ts
  app/
    page.tsx
    api/
      ag-ui/
        route.ts
```

The template includes the agent, calculator tool, chat page, AG-UI route, and
`AGENTS.md` project guide for coding agents.

## Authenticate

From the project directory, authenticate with Veryfront Cloud:

```bash
veryfront login
```

This lets the app use the Veryfront Cloud gateway for model inference. You can
also set `VERYFRONT_API_TOKEN` directly. Direct provider keys such as
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY` also work; see
[Providers](../guides/providers.md).

## Run it locally

```bash
veryfront dev
```

`veryfront dev` also starts the development MCP server on the app port plus 2.
With the default app port, coding agents can connect to
`http://localhost:3002/mcp` and call `vf_bootstrap` once at session start.
Use [Coding agents](../guides/coding-agents.md) for setup details.

## Verify it worked

Open `http://localhost:3000` and ask:

```text
What is 128 divided by 8?
```

To test the route without the UI:

```bash
curl -N -X POST http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is 128 divided by 8?"}]}]}'
```

The answer should stream. The curl response should emit `data:` lines.

## Preview and deploy it

From the project directory, push the source to its cloud preview:

```bash
npx veryfront@latest push
```

The command creates or links the cloud project, stores that local identity in
ignored `.veryfront/project.json`, and prints the preview URL. When the preview
is ready for production, deploy the exact pushed source digest:

Push preserves remote-only files by default. Use
`npx veryfront@latest push --prune --dry-run` to preview an exact remote mirror, then
run `npx veryfront@latest push --prune` only when those deletions are intentional.

```bash
npx veryfront@latest deploy --env production
```

Deploy uses the last verified Push receipt. If no receipt exists yet, it first
runs a quiet Push so the first production deploy still works as one command.

Project reference precedence is `VERYFRONT_PROJECT_SLUG` or environment
configuration, then `veryfront.config.ts`, then legacy `veryfront.json`, then
lower-level tenant or project-ID environment references, then the ignored local
link.
