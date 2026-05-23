---
title: "Installation"
description: "Install the Veryfront CLI and framework on macOS, Linux, or Windows."
order: 2
---

## Requirements

- macOS 12 or later, Linux x86_64 or arm64 (glibc), or Windows 10 or later.
- Node.js 18.18 or later for `npm`, `npx`, and app builds.
- Deno 1.45 or later, or Bun 1.1 or later, if you use those runtimes.
- 1 GB of free disk space and 2 GB of RAM for local development.

## Install

Use a binary installer for a global CLI. Use a package manager when you already
have an app. Use `npx` when you want to run the CLI once.

<CodeGroup>

```bash curl
curl -fsSL https://veryfront.com/install.sh | sh
```

```powershell PowerShell
irm https://veryfront.com/install.ps1 | iex
```

```bash Homebrew
brew install veryfront/tap/veryfront
```

```bash npx
npx veryfront
```

</CodeGroup>

### macOS and Linux

```bash
curl -fsSL https://veryfront.com/install.sh | sh
```

This installs the latest standalone binary and adds it to your shell path.
Homebrew installs the same binary:

```bash
brew install veryfront/tap/veryfront
```

### Windows

```powershell
irm https://veryfront.com/install.ps1 | iex
```

This installs the latest standalone binary and adds it to your user path.

### Existing project

Add Veryfront to an existing app when you do not want to scaffold a new project.

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

### npx (one-shot)

```bash
npx veryfront
```

Runs the latest `veryfront` CLI without installing it globally.

## Verify it worked

```bash
veryfront --version
```

You should see the installed version printed. If the command is not found,
restart your shell so the new `PATH` entry takes effect.
