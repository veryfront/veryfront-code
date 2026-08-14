---
title: "Add to an existing project"
description: "Install Veryfront Code into a TypeScript project you already have."
order: 5
---

Use this page to add Veryfront to a codebase that already exists. To start from
a scaffold instead, see [Create project](./create-project.md).

Veryfront installs as a normal dependency. It does not rewrite your
`package.json` scripts, your `tsconfig.json`, or any source file you already
have.

## Prerequisites

- Node.js 22.3 or later.
- An existing TypeScript project.

## Install the framework

```bash
npm install veryfront
```

The package ships the framework and the `veryfront` CLI, so you can run
commands with `npx veryfront <command>` without a global install. See
[Installation](./installation.md) for pnpm, yarn, bun, Deno, and global-CLI
variants.

## Configure TypeScript

The package ships a base config with everything Veryfront needs. Extending it is
the shortest correct route:

```json
{
  "extends": "veryfront/tsconfig.json",
  "include": ["src", "app"]
}
```

Make sure `include` covers wherever you keep your own source as well as your
routes.

### Setting the options yourself

If your project cannot extend that config, three settings matter:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "skipLibCheck": true
  }
}
```

**`moduleResolution`** must understand package exports. Veryfront's entry points
are subpaths such as `veryfront/agent`, which the older `node` and `classic`
modes cannot resolve:

```text
app/a.ts(1,23): error TS2307: Cannot find module 'veryfront/agent' or its corresponding type declarations.
  There are types at 'node_modules/veryfront/esm/src/agent/index.d.ts', but this result could not be
  resolved under your current 'moduleResolution' setting. Consider updating to 'node16', 'nodenext', or 'bundler'.
```

`bundler`, `node16`, and `nodenext` all work.

**`jsx`** is needed because Veryfront routes are `.tsx` files.

**`skipLibCheck`** is required, not merely recommended. Veryfront's MDX support
depends on `@types/mdx`, which refers to a global `JSX` namespace that React 19
no longer declares globally. Without it, `tsc` fails on a dependency you do not
import:

```text
node_modules/@types/mdx/types.d.ts(23,38): error TS2503: Cannot find namespace 'JSX'.
```

Scaffolded projects set all three already, which is why these only surface when
adding Veryfront to a project you already have.

## Add an entry route

Veryfront serves the `app/` directory. Without it the dev server still starts,
but reports that it found no route directories. Create one page:

```tsx
// app/page.tsx
export default function Home() {
  return <h1>Hello from Veryfront</h1>;
}
```

## Run it

```bash
npx veryfront dev
```

The CLI prints the URL it bound:

```text
✓ Ready in 2.1s
http://localhost:3000
```

The dev server uses port 3000 by default. When that port is taken it falls
forward and prints the port it actually used, so open the URL the CLI prints.

## Verify it worked

Open the URL the CLI printed. The page renders `Hello from Veryfront`.

To check it without a browser, use the port from that URL rather than assuming
3000. If the port fell forward, 3000 still belongs to whatever took it, so
curling it verifies the wrong server:

```bash
curl -s http://localhost:<PORT>/
```

The response contains `Hello from Veryfront`.

Your existing scripts are untouched. Confirm the build you had before still
runs:

```bash
npm run build
```

## Next steps

| Goal                    | Page                                    |
| ----------------------- | --------------------------------------- |
| Define an agent         | [Create agent](./create-agent.md)       |
| Expose an agent route   | [Create API](./create-api.md)           |
| Add a chat UI           | [Create frontend](./create-frontend.md) |
| Choose where models run | [Providers](../guides/providers.md)     |
