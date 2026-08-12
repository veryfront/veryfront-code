---
title: "Project structure"
description: "Where to put routes, AI primitives, shared code, and configuration."
order: 8
---

A Veryfront project keeps routes in `app/` or `pages/`. Keep runtime primitives
at the project root: `agents/`, `tools/`, `prompts/`, `workflows/`,
`resources/`, `skills/`, `tasks/`, `schedules/`, `webhooks/`, and `evals/`.
Veryfront discovers those directories on startup.

The examples use the default app router. Set `router: "pages"` in
`veryfront.config.ts` to use the pages router.

## Prerequisites

- A project created with `veryfront init` (see [Create project](../getting-started/create-project.md)), or a blank project with `veryfront` installed (see [Installation](../getting-started/installation.md)). Veryfront discovers these directories by convention either way.
- Familiarity with how a file path maps to a route in modern React frameworks.

## Directory layout

```
my-app/
  app/                  # Pages and API routes
    layout.tsx          # Root layout (wraps all pages)
    page.tsx            # Home page (/)
    about/
      page.mdx          # /about (MDX page)
    blog/
      [slug]/
        page.tsx         # /blog/:slug (dynamic route)
    api/
      chat/
        route.ts         # POST /api/ag-ui
  agents/               # AI agent definitions (auto-discovered)
    assistant.ts
  tools/                # Tool definitions (auto-discovered)
    get-weather.ts
  prompts/              # Prompt definitions (auto-discovered)
    assistant.ts
  workflows/            # Workflow definitions (auto-discovered)
    data-pipeline.ts
  resources/            # MCP resource definitions (auto-discovered)
    docs.ts
  skills/               # Skill packs (auto-discovered from SKILL.md)
    incident-response/
      SKILL.md
      references/
        runbook.md
      scripts/
        triage.sh
      assets/
        checklist.txt
  tasks/                # Background task definitions (auto-discovered)
  schedules/            # Schedule definitions (auto-discovered)
  webhooks/             # Webhook trigger definitions (auto-discovered)
  evals/                # Agent and workflow eval definitions (auto-discovered)
  components/           # Shared React components
    Header.tsx
  lib/                  # Shared utilities
    auth.ts
  content/              # App-owned content files
    posts/
      hello-world.mdx
  public/               # Static assets served as-is
    favicon.ico
  styles/               # Global stylesheets
    globals.css
  veryfront.config.ts   # Framework configuration (optional)
  package.json
  .cache/               # Generated bundles (written by the CLI, safe to delete)
  dist/                 # Build output (written by `veryfront build`)
```

## Routing directories

### `app/`

The `app/` directory contains pages, layouts, and API routes. File paths map to
URLs.

| File                       | URL           |
| -------------------------- | ------------- |
| `app/page.tsx`             | `/`           |
| `app/about/page.tsx`       | `/about`      |
| `app/blog/[slug]/page.tsx` | `/blog/:slug` |
| `app/api/users/route.ts`   | `/api/users`  |

Pages use `page.tsx` or `page.mdx`. API routes use `route.ts`. Layouts use
`layout.tsx`.

If `veryfront.config.ts` sets `router: "pages"`, use `pages/` and `pages/api/` instead.

Typical pages-router layout:

```text
pages/
  index.tsx
  about.tsx
  blog/[slug].tsx
  layout.tsx
  api/
    chat.ts
```

See [Pages and routing](./pages-and-routing.md) for route patterns, layouts,
dynamic params, and MDX.

## Auto-discovered directories

These directories are scanned automatically at startup.
For TypeScript-based primitives, valid default or named exports are registered.
For skills, immediate child directories containing `SKILL.md` are registered.

| Directory    | Purpose                           | Import                           |
| ------------ | --------------------------------- | -------------------------------- |
| `agents/`    | AI agent definitions              | `veryfront/agent`                |
| `tools/`     | Tool definitions with Zod schemas | `veryfront/tool`                 |
| `prompts/`   | Prompt templates                  | `veryfront/prompt`               |
| `workflows/` | Multi-step workflow DAGs          | `veryfront/workflow`             |
| `resources/` | MCP-exposable resources           | `veryfront/resource`             |
| `skills/`    | Skill packs advertised to agents  | Loaded with built-in skill tools |
| `tasks/`     | Background task definitions       | `veryfront/task`                 |
| `schedules/` | Scheduled trigger definitions     | `veryfront/schedule`             |
| `webhooks/`  | Webhook trigger definitions       | `veryfront/webhook`              |
| `evals/`     | Agent and workflow evaluations    | `veryfront/eval`                 |

TypeScript primitives are registered from their exported definitions. Discovery
scans `.ts` and `.tsx` files. Agents can use the filename as the ID when no
explicit ID is provided.

Agent discovery also supports `agents/assistant.md`. Use frontmatter for
metadata and the markdown body for system instructions.

For skills, the directory name is always the skill ID; a differing legacy or
display-style frontmatter `name` is treated as presentation metadata and never
changes lookup. For example, `skills/incident-response/SKILL.md` registers as
`"incident-response"`.

Verify discovery by starting the dev server after adding an agent, tool, or
workflow:

```bash
veryfront dev
```

Then open the dev dashboard or call a route that uses the primitive.
`getAgent("assistant")` should resolve after `agents/assistant.ts` exists and
the server reloads.

### Customizing discovery paths

Override the default directories in `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  directories: {
    app: "src/app",
  },
  ai: {
    tools: { discovery: { paths: ["tools"] } },
    agents: { discovery: { paths: ["agents"] } },
    skills: { discovery: { paths: ["skills", "team-skills"] } },
  },
});
```

## Convention directories

These directories are not auto-discovered. They are common project conventions.

| Directory     | Purpose                             |
| ------------- | ----------------------------------- |
| `components/` | Shared React components             |
| `lib/`        | Shared utilities and business logic |
| `content/`    | App-owned content files             |
| `public/`     | Static assets served at root path   |
| `styles/`     | Global CSS files                    |
| `middleware/` | Custom middleware functions         |

## Generated directories

These directories hold derived output only, so deleting them is safe: the next
command regenerates whatever it needs. `dist/` is always written into the
project root. `.cache/` is too during development, but not under a production
runtime — see "Where the cache root lives" below.

| Directory | Written by                         | Contents                                                                                                  |
| --------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.cache/` | `veryfront dev`, `veryfront build` | Compiled page modules in `veryfront-mdx-esm/` and bundled remote dependencies in `veryfront-http-bundle/` |
| `dist/`   | `veryfront build`                  | The build output. `-o/--output` and `build.outDir` change the location                                    |

### Where the cache root lives

The cache root is `.cache/` in the project directory during development. Under
a production runtime it is not in the project at all: when `NODE_ENV` or
`VERYFRONT_MODE` is `production` and `HOME` is set, the cache root is
`.cache/veryfront` inside the home directory instead, so a deployed project
directory that is read-only still has somewhere to write. Both roots hold the
same `veryfront-mdx-esm/` and `veryfront-http-bundle/` subdirectories.

Set `VERYFRONT_CACHE_DIR` (or `VF_CACHE_DIR`) to choose the location yourself.
It wins in both modes, so it is also how you keep generated bundles out of the
project tree during development:

```bash
VERYFRONT_CACHE_DIR=/tmp/veryfront-cache veryfront dev
```

### Keeping the cache out of version control

The cache root keeps itself out of version control. When the file is absent,
both commands create a `.gitignore` in the cache root containing `*`, which
ignores the directory's contents and the file itself, so a project that adopted
Veryfront into an existing tree does not have to edit its own `.gitignore`. A
marker you wrote yourself — a `.cache/.gitignore` of your own, say — is never
overwritten in either root, so keep the generated bundles ignored there if you
replace it. `veryfront init` also lists `.cache/` in the `.gitignore` it
scaffolds.

Deleting the cache root costs only time. The next run recompiles the pages and
refetches the remote dependencies it needs.

## Special files

| File                  | Purpose                        |
| --------------------- | ------------------------------ |
| `app/layout.tsx`      | Root layout wrapping all pages |
| `app/error.tsx`       | Error boundary for the app     |
| `app/not-found.tsx`   | Custom 404 page                |
| `veryfront.config.ts` | Framework configuration        |
| `package.json`        | Dependencies and metadata      |

## Generated directories

The CLI writes these directories into the project root. They hold derived
output only, so deleting them is safe: the next command regenerates whatever it
needs.

| Directory | Written by                         | Contents                                                                                                 |
| --------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `.cache/` | `veryfront dev`, `veryfront build` | Compiled page modules in `veryfront-mdx-esm/` and bundled remote dependencies in `veryfront-http-bundle/` |
| `dist/`   | `veryfront build`                  | The build output. `-o/--output` and `build.outDir` change the location                                    |

`.cache/` keeps itself out of version control. When the file is absent, both
commands create a `.cache/.gitignore` containing `*`, which ignores the
directory's contents and the file itself, so a project that adopted Veryfront
into an existing tree does not have to edit its own `.gitignore`. A
`.cache/.gitignore` you wrote yourself is never overwritten, so keep the
generated bundles ignored there if you replace it. `veryfront init` also lists
`.cache/` in the `.gitignore` it scaffolds.

Set `VERYFRONT_CACHE_DIR` to keep generated bundles out of the project tree
entirely:

```bash
VERYFRONT_CACHE_DIR=/tmp/veryfront-cache veryfront dev
```

Deleting `.cache/` costs only time. The next run recompiles the pages and
refetches the remote dependencies it needs.

## Verify it worked

Add a file in any auto-discovered directory and restart `veryfront dev`. For
example, add `agents/hello.ts`:

```ts
import { agent } from "veryfront/agent";

export default agent({ id: "hello", system: "Say hi." });
```

The dev server log should confirm agent registration. `getAgent("hello")`
should resolve from a route or test.
