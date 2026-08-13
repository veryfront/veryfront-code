---
title: "Quickstart"
description: "Build, run, and evaluate your first Veryfront agent app locally."
order: -1
---

Veryfront Code runs locally with your chosen inference backend. This quickstart
does not require a Veryfront account or Veryfront Cloud.

## Prerequisites

- Node.js 22.3 or later.
- An OpenAI API key. This tutorial uses OpenAI directly for model inference.

You need access to model inference to run the agent and its eval. Veryfront Code
also supports other API-based providers, OpenAI-compatible local servers, and
built-in local models.

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

## Configure inference

Set the OpenAI API key in the terminal where you will run Veryfront:

```bash
export OPENAI_API_KEY="<API_KEY>"
```

The starter uses `openai/gpt-5.4-nano`. Veryfront sends these inference requests
directly to OpenAI, not through Veryfront Cloud.

## Run it locally

```bash
veryfront dev
```

The CLI prints the URL it is serving on:

```
✓ Ready in 1.3s
http://localhost:3000
```

`localhost` resolves to `127.0.0.1` on every machine without a DNS lookup, so
[http://localhost:3000](http://localhost:3000) always reaches the dev server.

The dev server uses port 3000 by default. You can also set the `PORT` env var
instead of the flag; `veryfront dev` reads it as a lower-precedence default,
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
[http://localhost:3000](http://localhost:3000). Ask:

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

## Run the eval

Stop the dev server with `Ctrl+C`, then run the included smoke eval:

```bash
veryfront eval assistant
```

The eval sends a calculator prompt to the same agent, checks that the agent calls
the calculator tool, and verifies the answer. The command exits successfully
when every required check passes.

## Next steps

The local development and eval workflow is complete. Continue with the guide
that matches your next goal:

- [Use another inference provider](../guides/providers.md): connect Anthropic,
  Google, an OpenAI-compatible local server such as Ollama or LM Studio, or a
  built-in local model.
- [Self-host the app](../guides/deploying.md#self-host): build and run
  the project in your own environment.
- [Deploy with Veryfront Cloud](./deploy-project.md): use managed previews and
  deployment when you want those services. Veryfront Cloud environments are
  protected by default.
