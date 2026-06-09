---
title: "Create project"
description: "Scaffold a new Veryfront project from a template and run it locally."
order: 3
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

The wizard asks which template to use.

Choose a starting point directly when you already know what you want to build,
or when running the command from a non-interactive script:

```bash
# Agent app with a chat UI, tool, and AG-UI route
veryfront init support-agent --template ai-agent

# Blank full-stack app with pages and routing
veryfront init web-app --template minimal

# Durable multi-step AI pipeline
veryfront init workflow-app --template agentic-workflow
```

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
  `deno task build` / `deno task preview` work without extra setup. Deno reads
  npm dependencies directly from `package.json` via `nodeModulesDir: "auto"`.
- The install command and the printed next-steps match your runtime
  (`npm install` / `bun install` / `deno install`).

You can also set `"runtime": "deno"` in the JSON file passed to `--config`.

### Use a package manager

Use these commands when you do not have the Veryfront CLI installed globally.

<CodeGroup>

```bash npm
npm create veryfront
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

Open [http://localhost:3000](http://localhost:3000). File changes reload the
browser.

## Inspect the scaffold

The `minimal` template creates:

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

The `ai-agent` template also creates:

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
`tools/`. For the convention behind these directories, see
[Framework conventions](../concepts/framework-conventions.md).

## Verify it worked

`veryfront dev` prints `Ready on http://localhost:3000`. Open the URL and save a
source file. The browser should hot-reload.
