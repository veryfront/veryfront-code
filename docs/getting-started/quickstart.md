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
npm create veryfront@latest support-agent -- --template ai-agent
cd support-agent
```

Passing `-- --template <template>` scaffolds straight away and is what the rest
of this page assumes. Omit it and the command opens an interactive setup wizard
that waits for three answers (starter template, runtime, and whether to
initialize Git) before it writes anything. See
[Create project](./create-project.md) for the wizard. The wizard only appears in
a terminal; in CI, scripts, and other non-interactive shells the command falls
back to `ai-agent` on Node.js without Git.

The `ai-agent` template creates a runnable chat app:

```text
support-agent/
  .gitignore
  AGENTS.md
  README.md
  agents/
    assistant.ts
  tools/
    calculator.ts
  evals/
    assistant.eval.ts
  app/
    layout.tsx
    page.tsx
    markdown-renderer.tsx
    api/
      ag-ui/
        route.ts
  public/
    favicon.svg
  globals.css
  globals.d.ts
  package.json
  tsconfig.json
```

The template includes the agent, calculator tool, chat page, AG-UI route, a
smoke eval you run with `veryfront eval` (see [Evals](../guides/evals.md)), and
the `AGENTS.md` project guide for coding agents.

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

The CLI prints the URL it is serving on:

```
  ✓ Ready in 1.3s
  http://veryfront.me:3000
```

`veryfront.me` resolves to `127.0.0.1`, so
[http://localhost:3000](http://localhost:3000) reaches the same server.

The dev server uses port 3000 by default. You can also set the `PORT` env var
instead of the flag — `veryfront dev` reads it as a lower-precedence default,
the same way Next.js, Vite, Heroku, and Railway all treat `PORT`:

```bash
PORT=3001 veryfront dev          # bind 3001
veryfront dev --port 4000        # --port wins over PORT when both are set
```

When the requested port is already taken, `veryfront dev` prints
`! Port 3001 is in use, using 3002 instead` and serves on the first free port,
so open the URL the CLI prints.

`veryfront dev` also starts the development MCP server two ports above the port
the dev server bound, so it moves with the app port when that falls forward.
With the default app port, coding agents can connect to
`http://localhost:3002/mcp` and call `vf_bootstrap` once at session start.
Use [Coding agents](../guides/coding-agents.md) for setup details.

## Verify it worked

Open the URL `veryfront dev` printed. Unless the port moved, that is
[http://veryfront.me:3000](http://veryfront.me:3000). Ask:

```text
What is 128 divided by 8?
```

To test the route without the UI, using that same port:

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

Both URLs are protected by default: they open for a browser signed in to
Veryfront as a member of the project, and redirect everyone else to the sign-in
page. See
[Environment access](./deploy-project.md#environment-access) before sharing a
URL or pointing a smoke test at it.

Project reference precedence is `VERYFRONT_PROJECT_SLUG` or environment
configuration, then `veryfront.config.ts`, then legacy `veryfront.json`, then
lower-level tenant or project-ID environment references, then the ignored local
link.
