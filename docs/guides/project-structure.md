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

- A project created with `veryfront init` (see [Create project](../getting-started/create-project.md)).
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

TypeScript primitives are registered from their exported definitions. Agents can
use the filename as the ID when no explicit ID is provided.

Discovery scans `.ts` and `.tsx` files. It skips dependency, VCS, and
test-fixture trees, plus `*.test.*`, `*.spec.*`, `*.bench.*`, and declaration
files. A malformed primitive is reported as a discovery error; server startup
and live reload retain the previous complete generation instead of publishing a
partial replacement.

Agent discovery also supports `agents/assistant.md`. Use frontmatter for
metadata and the markdown body for system instructions.

For skills, the directory name is the skill ID and the required frontmatter
`name` must match it exactly. For example,
`skills/incident-response/SKILL.md` registers as `"incident-response"` when its
frontmatter declares `name: incident-response`.

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

Discovery paths must stay inside the project and use canonical relative
segments. Do not use absolute paths, file URLs, empty segments, `.`, or `..`.
Each primitive accepts at most 100 configured roots.

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

## Special files

| File                  | Purpose                        |
| --------------------- | ------------------------------ |
| `app/layout.tsx`      | Root layout wrapping all pages |
| `app/error.tsx`       | Error boundary for the app     |
| `app/not-found.tsx`   | Custom 404 page                |
| `veryfront.config.ts` | Framework configuration        |
| `package.json`        | Dependencies and metadata      |

## Verify it worked

Add a file in any auto-discovered directory and restart `veryfront dev`. For
example, add `agents/hello.ts`:

```ts
import { agent } from "veryfront/agent";

export default agent({ id: "hello", system: "Say hi." });
```

The dev server log should confirm agent registration. `getAgent("hello")`
should resolve from a route or test.
