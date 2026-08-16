---
title: "Installation"
description: "Install Veryfront Code on macOS, Linux, or Windows."
order: 3
---

## Requirements

- macOS 12 or later, Linux x86_64 or arm64 (glibc), or Windows 10 or later.
- For package-manager installations, Node.js 22.3 or later, Deno 2.2 or later,
  or Bun 1.1 or later. The standalone binary includes its runtime.
- 2 GB of RAM for local development.
- Disk space for the selected CLI installation and project dependencies. See
  [Install the CLI](#install-the-cli) for current artifact sizes.

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

Installing the package adds the framework, the CLI, and `react` / `react-dom`,
which ship as dependencies of `veryfront`. It does not scaffold any files or
touch your `package.json` beyond the dependency entry. Add the four pieces
below yourself. `veryfront init` writes all of them for you, see
[Create project](./create-project.md).

### Set the module type

Veryfront emits ES modules. Set `"type": "module"` in `package.json`:

```json title="package.json"
{
  "type": "module"
}
```

`npm init -y` writes `"type": "commonjs"`, and an existing project may have no
`type` field at all. Without `"type": "module"`, `veryfront build` fails with
`SyntaxError: Cannot use import statement outside a module`.

### Add the CLI scripts

```json title="package.json"
{
  "scripts": {
    "dev": "veryfront dev",
    "build": "veryfront build",
    "start": "veryfront serve"
  }
}
```

### Extend the base TypeScript config

The `veryfront` package ships a base `tsconfig.json` with the compiler options
Veryfront expects, including `"jsx": "react-jsx"` and
`"moduleResolution": "Bundler"`. Extend it:

```json title="tsconfig.json"
{
  "extends": "veryfront/tsconfig.json",
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

The base config sets `"noEmit": true` because Veryfront bundles your routes. If
your existing build uses `tsc` to emit JavaScript, do not use this extends form:
the build exits 0 but stops emitting. Keep your existing config and add the
required compiler options, or set `"noEmit": false` in the config your build
uses. See [Add to an existing project](./add-to-existing-project.md).

### Add a page and run it

Veryfront discovers routes under `app/`. Create a home page:

```tsx title="app/page.tsx"
export default function Home() {
  return <h1>Hello from Veryfront</h1>;
}
```

Then start the dev server:

```bash
npm run dev
```

Open the URL the CLI prints, `http://localhost:3000` by default, to see the
page.

For where the remaining files go, see
[Project structure](../guides/project-structure.md). To add an API route under
`app/api/`, see [Create API](./create-api.md).

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

```bash deno
deno init --npm veryfront
```

</CodeGroup>

## Install the CLI

Install the CLI globally when you use Veryfront commands often.

| Method            | Use when                                          | Approximate size                            |
| ----------------- | ------------------------------------------------- | ------------------------------------------- |
| npm package       | You use Node.js, Deno, Bun, or another npm client | 6 MB download, 28 MB before dependencies    |
| Standalone binary | You need one executable with an included runtime  | 0.9 to 1.2 GB for the downloaded executable |

These measurements describe recent releases and vary by platform and package
manager. A clean global npm installation used approximately 145 MB in one
measurement. Model weights are not included. The optional embedded ONNX runtime
adds approximately 500 MB, and supported model weights add 0.9 to 6 GB.

### npm (recommended)

```bash
npm install -g veryfront@latest
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

### deno

```bash
deno install -gArf npm:veryfront
```

The CLI is published to npm only, so install it through Deno's `npm:`
specifier. Deno resolves that specifier from the current working directory, so
inside a project that depends on `veryfront` the global binary runs that
project's version instead. Run `veryfront --version` outside any project
directory to see the globally installed version.

### Standalone binary

Use the standalone binary when you need an executable that includes its own
runtime. On macOS or Linux, run:

```bash
curl -fsSL https://veryfront.com/install.sh | sh
```

On Windows PowerShell, run:

```powershell
irm https://veryfront.com/install.ps1 | iex
```

Both installers verify what they download. Each release publishes a `SHA256SUMS`
manifest; the binary is staged, checked against it, and only then moved into
place, so a mismatch installs nothing. Releases published before that manifest
existed have none, so pinning to one of those fails unless you set
`VERYFRONT_INSTALL_SKIP_CHECKSUM=1` deliberately.

The commands still execute a script fetched at run time. To read it first, and
to pin a version instead of tracking latest:

```bash
curl -fsSL https://veryfront.com/install.sh -o install.sh
less install.sh
sh install.sh --version <VERSION>
```

To skip the installer entirely, download the binary for your platform from the
[release assets](https://github.com/veryfront/veryfront/releases) and put it on
your path. Check it against the `SHA256SUMS` published with the same release:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

The installer downloads the binary for the current platform and adds it to your
shell path. Embedded ONNX inference is not available from compiled standalone
binaries. Use a package-manager installation when the app runs an embedded
ONNX model.

## One-shot CLI usage

Use `npx` when you do not want a global install:

```bash
npx veryfront@latest
```

Runs the latest published `veryfront` CLI without installing it globally.

Use `npm create veryfront` when you want to scaffold a new project.

## Coding-agent setup

Starter templates include `AGENTS.md`. For older projects, install the shared
project guide with `--target agents`:

```bash
veryfront install --target agents
```

Then run `veryfront dev`. It starts an HTTP MCP server two ports above the port
the dev server actually bound, always at the path `/mcp`. With the default port
3000 that is `http://localhost:3002/mcp`, so point your MCP-aware coding
agent there.

Read the port off the URL the dev server printed rather than off the `--port`
you asked for. When the requested port is taken, `veryfront dev` moves to the
next free one, and MCP follows it: a dev server that falls forward to 3001
serves MCP on 3003. The dev server lists the MCP address itself only under
`--verbose`. See [Coding agents](../guides/coding-agents.md).

## Verify the CLI

```bash
veryfront --version
```

You should see the installed version printed. If the command is not found,
restart your shell so the new `PATH` entry takes effect.
