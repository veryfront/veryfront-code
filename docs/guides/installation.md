---
title: "Installation"
description: "Install the Veryfront CLI and framework on macOS, Linux, or Windows."
order: 1
---

Install the `veryfront` CLI and framework so you can scaffold, run, and build Veryfront projects.

Most users want the Quickstart flow that follows. The install methods below all produce the same `veryfront` CLI; pick the one that matches your toolchain.

For the terminal, runtime, and network access prerequisites, see the Veryfront Code docs landing page.

## System requirements

Veryfront ships as a standalone binary and as an npm package. Pick the rows that match how you plan to install it.

### Operating system

| OS                                          | Binary installer               | npm / npx |
| ------------------------------------------- | ------------------------------ | --------- |
| macOS 12 or later (Intel and Apple Silicon) | Yes (`curl` or Homebrew)       | Yes       |
| Linux x86_64 and arm64 (glibc)              | Yes (`curl` or Homebrew)       | Yes       |
| Windows 10 or later, x86_64 and arm64       | Yes (PowerShell `install.ps1`) | Yes       |

### Runtime

| Runtime | Minimum version | Notes                                                 |
| ------- | --------------- | ----------------------------------------------------- |
| Node.js | 18.18           | Required for `npm`, `npx`, and the framework runtime. |
| Deno    | 1.45            | Optional; supports running the framework directly.    |
| Bun     | 1.1             | Optional; supports running the framework directly.    |

### Hardware

- 1 GB of free disk space for the CLI, framework, and `node_modules`.
- 2 GB of RAM for development; 4 GB or more is recommended when running an AI agent locally.

## Supported browsers

Veryfront renders React Server Components and ships modern ES2022 client bundles. The built-in chat UI, router, and head components are tested against the latest two stable releases of:

- Chrome and Chromium-based browsers (Edge, Brave, Arc, Opera)
- Firefox
- Safari (macOS 14 and iOS 16 or later)

Older browsers may work but are not part of the supported matrix.

## Install

Pick the method that matches your toolchain. All five produce the same `veryfront` CLI; the tabs below give you the one-liner, and the sections that follow add detail and version-pinning options.

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

Installs the latest standalone binary to `~/.veryfront/bin/veryfront`. Recommended for macOS and Linux when you mainly use the CLI and TUI.

Pin a version or change the install directory:

```bash
curl -fsSL https://veryfront.com/install.sh | sh -s -- --version 0.1.0 --dir /usr/local/bin
```

### PowerShell (standalone binary, Windows)

```powershell
irm https://veryfront.com/install.ps1 | iex
```

Installs the latest standalone binary to `%USERPROFILE%\.veryfront\bin\veryfront.exe`. Supports Windows 10 or later on `x86_64` and `arm64`.

Pin a version or change the install directory:

```powershell
& ([scriptblock]::Create((irm https://veryfront.com/install.ps1))) -Version 0.1.0 -Dir C:\Tools\veryfront
```

### Homebrew

```bash
brew install veryfront/tap/veryfront
```

Same binary as the curl installer, managed by Homebrew. Works on macOS and Linux.

### npm (project scaffolder)

```bash
npm create veryfront
```

Creates a new project using `create-veryfront`. The same command works with the other Node-compatible package managers:

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

Runs the latest `veryfront` CLI without installing it globally. Useful for trying commands or one-off scripts in CI.

## Verify it worked

```bash
veryfront --version
```

You should see the installed version printed. If the command is not found after a fresh install, restart your shell so the new `PATH` entry takes effect.

On Windows, run the same command in PowerShell or in a new terminal session so the updated `PATH` is picked up.

## Next

- [Create a project](./create-a-project.md): create and run your first Veryfront project in under two minutes.
- [Project structure](./project-structure.md): learn the conventions the CLI scaffolds.
- [Configuration](./configuration.md): wire up environment variables and runtime options.
