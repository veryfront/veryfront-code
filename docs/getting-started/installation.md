---
title: "Installation"
description: "Install the Veryfront CLI and framework on macOS, Linux, or Windows."
order: 2
---

Install the `veryfront` CLI and framework.

## System requirements

Veryfront ships as a standalone binary and as an npm package.

### Operating system

| OS                                          | Binary installer               | npm / npx |
| ------------------------------------------- | ------------------------------ | --------- |
| macOS 12 or later (Intel and Apple Silicon) | Yes (`curl` or Homebrew)       | Yes       |
| Linux x86_64 and arm64 (glibc)              | Yes (`curl` or Homebrew)       | Yes       |
| Windows 10 or later, x86_64 and arm64       | Yes (PowerShell `install.ps1`) | Yes       |

### Runtime

| Runtime | Minimum version | Notes                                      |
| ------- | --------------- | ------------------------------------------ |
| Node.js | 18.18           | Required for `npm`, `npx`, and app builds. |
| Deno    | 1.45            | Optional direct runtime.                   |
| Bun     | 1.1             | Optional direct runtime.                   |

### Hardware

- 1 GB of free disk space for the CLI, framework, and `node_modules`.
- 2 GB of RAM for development; 4 GB or more is recommended when running an AI
  agent locally.

## Supported browsers

Veryfront tests the built-in chat UI, router, and head components against the
latest two stable releases of:

- Chrome and Chromium-based browsers (Edge, Brave, Arc, Opera)
- Firefox
- Safari (macOS 14 and iOS 16 or later)

Older browsers may work but are not part of the supported matrix.

## Install

Pick the command that matches your toolchain.

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

```bash npm
npm create veryfront
```

```bash npx
npx veryfront
```

</CodeGroup>

### curl (standalone binary, macOS and Linux)

```bash
curl -fsSL https://veryfront.com/install.sh | sh
```

Installs the latest standalone binary to `~/.veryfront/bin/veryfront`.

Pin a version or change the install directory:

```bash
curl -fsSL https://veryfront.com/install.sh | sh -s -- --version 0.1.0 --dir /usr/local/bin
```

### PowerShell (standalone binary, Windows)

```powershell
irm https://veryfront.com/install.ps1 | iex
```

Installs the latest standalone binary to
`%USERPROFILE%\.veryfront\bin\veryfront.exe`.

Pin a version or change the install directory:

```powershell
& ([scriptblock]::Create((irm https://veryfront.com/install.ps1))) -Version 0.1.0 -Dir C:\Tools\veryfront
```

### Homebrew

```bash
brew install veryfront/tap/veryfront
```

Same binary as the curl installer, managed by Homebrew.

### npm (project scaffolder)

```bash
npm create veryfront
```

Creates a new project using `create-veryfront`. Other package managers:

```bash
pnpm create veryfront
yarn create veryfront
bun create veryfront
deno init --npm veryfront
```

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

## Next

- [Create project](./create-project.md): create and run your first Veryfront
  project in under two minutes.
- [Project structure](../guides/project-structure.md): learn the conventions the
  CLI scaffolds.
- [Configuration](../guides/configuration.md): wire up environment variables and
  runtime options.
