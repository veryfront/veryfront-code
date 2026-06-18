---
title: "Installation"
description: "Install Veryfront Code on macOS, Linux, or Windows."
order: 2
---

## Requirements

- macOS 12 or later, Linux x86_64 or arm64 (glibc), or Windows 10 or later.
- A JavaScript runtime: Node.js 18.18 or later, Deno 1.45 or later, or Bun
  1.1 or later.
- 1 GB of free disk space and 2 GB of RAM for local development.

## Blank or existing project

Add Veryfront Code to an existing or blank Node.js, Deno, or Bun project.

<CodeGroup>

```bash npm
npm install veryfront
```

```bash pnpm
pnpm add veryfront
```

```bash yarn
yarn add veryfront
```

```bash bun
bun add veryfront
```

```bash deno
deno add npm:veryfront
```

</CodeGroup>

## New scaffolded project

Create a new Veryfront Code project when you want scaffolding and starter files.

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

</CodeGroup>

## Install the CLI

Install the CLI globally when you use Veryfront commands often.

### npm

```bash
npm install -g veryfront
```

This installs the latest published Veryfront CLI and adds `veryfront` to your
shell path.

### pnpm

```bash
pnpm add -g veryfront
```

### yarn

```bash
yarn global add veryfront
```

### bun

```bash
bun add -g veryfront
```

## One-shot CLI usage

Use `npx` when you do not want a global install:

```bash
npx veryfront
```

Runs the latest published `veryfront` CLI without installing it globally.

Use `npm create veryfront` when you want to scaffold a new project.

## Coding-agent setup

Starter templates include `AGENTS.md`. For older projects, install the shared
project guide:

```bash
veryfront install agents
```

Then run `veryfront dev` and connect your MCP-aware coding agent to the printed
MCP endpoint. See [Coding agents](../guides/coding-agents.md).

## Verify the CLI

```bash
veryfront --version
```

You should see the installed version printed. If the command is not found,
restart your shell so the new `PATH` entry takes effect.
