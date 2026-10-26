---
sidebarSection: guides
title: "Create project"
description: "Scaffold a new Veryfront project from a template and run it locally."
order: 4
---

## Prerequisites

- The Veryfront CLI installed (see [Installation](./installation.md)).
- A terminal in which you can run `veryfront init`.

## Scaffold

Run `veryfront init` to open the project wizard:

```bash
veryfront init test-app
cd test-app
```

The wizard asks three questions in order and waits for an answer on each:

```text
Choose a starter template:   preselects ai-agent
Select runtime:              preselects Node.js
Initialize Git?              preselects Yes
```

Press Enter three times to accept the preselected answers, or use the arrow keys
to change an answer first.

The wizard needs a terminal. In non-interactive environments (CI, piped stdin,
scripts), `veryfront init` skips every prompt and uses `ai-agent` on Node.js
without initializing Git. Passing `--template` also skips the whole wizard,
including the runtime and Git questions.

To choose a template without the wizard, pass its name:

```bash
# Blank full-stack app with pages and routing
veryfront init web-app --template minimal

# Durable multi-step AI pipeline
veryfront init workflow-app --template agentic-workflow
```

If the project needs end-user login, add it after the initial app is running
with `veryfront generate auth <provider>` or by configuring
[`security.auth.oidc`](../guides/application-auth.md). This works for new
projects and existing apps because the scaffold adds config and environment
placeholders without replacing your routes.

### Choose a runtime

By default, `veryfront init` scaffolds projects for **Node.js**. Pass
`--runtime <node|bun|deno>` to select a different JavaScript runtime:

```bash
veryfront init test-app --template ai-agent --runtime bun
veryfront init test-app --template ai-agent --runtime deno
```

What this changes:

- All runtimes get the same `package.json` and template files.
- `--runtime deno` additionally writes a thin `deno.json` so `deno task dev` /
  `deno task build` / `deno task start` / `deno task eval` work without extra
  setup. Deno reads npm dependencies directly from `package.json` via
  `nodeModulesDir: "auto"`.
- The install command and the printed next-steps match your runtime
  (`npm install` / `bun install` / `deno install`).

You can also set `"runtime": "deno"` in the JSON file passed to `--config`.

### Use a package manager

Use these commands when you do not have the Veryfront CLI installed globally.

<CodeGroup>

```bash npm
npm create veryfront@latest my-agent
```

```bash pnpm
pnpm create veryfront
```

```bash yarn
yarn create veryfront
```

```bash bun
bun create veryfront
```

```bash deno
deno init --npm veryfront
```

</CodeGroup>

## Run the dev server

```bash
veryfront dev
```

The CLI prints the URL it is serving on:

```
✓ App ready       http://localhost:3000
  Execution       This machine
```

Open [http://localhost:3000](http://localhost:3000). `localhost` resolves to
`127.0.0.1` on every machine without a DNS lookup. File changes reload the
browser.

### Use project hosts from native clients

Multi-project browser URLs use `http://<PROJECT>.localhost:<PORT>`. Preview
browser URLs use `http://<PROJECT>.preview.localhost:<PORT>`. Chromium treats
the reserved `.localhost` tree as loopback on Windows.

Native Node, Deno, and command-line resolvers can depend on operating-system
resolver behavior for wildcard names. Veryfront's Windows Server 2022 CI
records `ENOTFOUND` from Node 24 for project and preview hosts. Runtime versions
can differ in their IPv4 and IPv6 loopback resolution. Use literal loopback
transport and keep the canonical virtual host when a native request does not
resolve the browser URL:

```bash
curl -H "Host: <PROJECT>.localhost:<PORT>" http://127.0.0.1:<PORT>/
curl -H "Host: <PROJECT>.preview.localhost:<PORT>" http://127.0.0.1:<PORT>/
```

This fallback stays on the local machine and preserves the distinction between
project and preview routes. Do not replace it with a public loopback DNS name.

### Change the port

The dev server binds port 3000. Pass `--port` to bind a different one:

```bash
veryfront dev --port 4000
```

When the requested port is already taken, `veryfront dev` does not fail. It
scans forward for the first free port, reports the switch, and serves there:

```
  ! Port 3000 is in use, using 3001 instead

  ✓ App ready       http://localhost:3001
  Execution       This machine
```

Open the URL the CLI prints, not the one in the examples above. The development
MCP server follows the port the dev server bound, plus 2.

## Inspect the scaffold

The `minimal` template creates:

```text
test-app/
  .gitignore
  AGENTS.md         # Project guide for coding agents
  README.md
  app/
    layout.tsx      # Root layout wrapping all pages
    page.tsx        # Home page (/)
    about/
      page.mdx      # /about (MDX page)
  public/
    favicon.svg
  globals.css       # Tailwind entry stylesheet
  globals.d.ts
  package.json
  tsconfig.json
```

The `ai-agent` template creates:

```text
test-app/
  .gitignore
  AGENTS.md         # Project guide for coding agents
  README.md
  agents/
    assistant.ts    # AI agent definition
  tools/
    calculator.ts   # Tool the agent can call
  evals/
    assistant.eval.ts   # Smoke eval for the agent, run with `veryfront eval`
  app/
    layout.tsx
    page.tsx        # Chat UI
    markdown-renderer.tsx   # Renders assistant replies as markdown
    api/
      ag-ui/
        route.ts    # AG-UI streaming chat endpoint
  public/
    favicon.svg
  globals.css
  globals.d.ts
  package.json
  tsconfig.json
```

Pages live in `app/`. The agent template also adds root-level `agents/`,
`tools/`, and `evals/`. For the convention behind these directories, see
[Framework conventions](../concepts/framework-conventions.md).

Generate additional app and AI primitives from the project root:

```bash
veryfront generate agent research-agent
veryfront generate tool search-docs
veryfront generate skill research
```

Edit the generated instructions, tools and skills for your app.

Every starter includes `AGENTS.md`. Coding agents should read that file first,
then use `veryfront schema --json` or the Veryfront MCP tools for current CLI
and project facts. Use [Coding agents](../guides/coding-agents.md) to connect
Claude Code, Cursor, Codex, or another MCP-aware agent.

## Verify it worked

`veryfront dev` prints `App ready` with the local URL and identifies execution
as `This machine`. Linked projects also show the connected Veryfront service,
project, shared environment, signed-in account, and Studio run list URL.
A local API is labeled `Local Veryfront`; hosted APIs use `Veryfront Cloud`.
Press `?` for shortcuts; use verbose logs for cache and runtime diagnostics.

Open the app URL and save a source file. The browser should hot-reload.

## Name your local worker

Studio identifies local runs by the machine hostname by default. To use a
recognizable label, set it before starting the app:

```bash
VERYFRONT_WORKER_NAME="Kentaro laptop" npm run dev
```

Names are limited to 128 characters. The label does not change the project,
environment, or unique runtime identity.
