---
title: "Project Structure"
description: "File conventions, directory layout, and how auto-discovery works."
order: 2
---

# Project Structure

File conventions, directory layout, and how auto-discovery works.

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
        route.ts         # POST /api/chat
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
  components/           # Shared React components
    Header.tsx
  lib/                  # Shared utilities
    auth.ts
  content/              # Static content (MDX posts, data files)
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

The `app/` directory contains pages and API routes. The file path maps directly to the URL:

| File | URL |
|------|-----|
| `app/page.tsx` | `/` |
| `app/about/page.tsx` | `/about` |
| `app/blog/[slug]/page.tsx` | `/blog/:slug` |
| `app/api/users/route.ts` | `/api/users` |

Pages use `page.tsx` (or `page.mdx`). API routes use `route.ts`. Layouts use `layout.tsx`.

See [Pages & Routing](./pages-and-routing.md) for the full routing system.

## Auto-discovered directories

These directories are scanned automatically at startup.
For TypeScript-based primitives, files with a default export are registered.
For skills, directories containing `SKILL.md` are registered.

| Directory | Purpose | Import |
|-----------|---------|--------|
| `agents/` | AI agent definitions | `veryfront/agent` |
| `tools/` | Tool definitions with Zod schemas | `veryfront/tool` |
| `prompts/` | Prompt templates | `veryfront/prompt` |
| `workflows/` | Multi-step workflow DAGs | `veryfront/workflow` |
| `resources/` | MCP-exposable resources | `veryfront/resource` |
| `skills/` | Skill packs for agent skill tools | Enabled via `agent({ skills: ... })` |

The filename becomes the ID for TypeScript primitives. For example, `agents/assistant.ts` registers as `"assistant"` and can be retrieved with `getAgent("assistant")`.

For skills, the directory name is the skill ID. For example, `skills/incident-response/SKILL.md` registers as `"incident-response"`.

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
    skills: { discovery: { paths: ["skills", "internal/skills"] } },
  },
});
```

## Convention directories

These directories aren't auto-discovered but follow standard conventions:

| Directory | Purpose |
|-----------|---------|
| `components/` | Shared React components |
| `lib/` | Shared utilities and business logic |
| `content/` | Static content (MDX, JSON, YAML) |
| `public/` | Static assets served at root path |
| `styles/` | Global CSS files |
| `middleware/` | Custom middleware functions |

## Special files

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout wrapping all pages |
| `app/error.tsx` | Error boundary for the app |
| `app/not-found.tsx` | Custom 404 page |
| `veryfront.config.ts` | Framework configuration |
| `package.json` | Dependencies and metadata |

## Why flat?

Veryfront is an AI-native framework. Agents, tools, prompts, and workflows are first-class primitives — not add-ons tucked inside a subfolder. Keeping them at the project root makes them visible and accessible, just like `components/` or `lib/`.

## Next

- [Pages & Routing](./pages-and-routing.md) — file-based routing, layouts, and dynamic routes
- [Agents](./agents.md) — create your first AI agent

## Related

- [Configuration](./configuration.md) — `veryfront.config.ts` options
- [`veryfront` (root)](../reference/root.md) — core framework API reference
