---
name: veryfront
description: Build Veryfront apps. Use for real-time errors, route preview, HMR control, and scaffolding pages/APIs/components/AI tools.
license: MIT
compatibility: Veryfront dev server (deno task dev)
metadata:
  author: veryfront
  version: "1.0"
---

# Veryfront

React meta-framework with App Router and AI-native capabilities.

## What MCP Adds

You already have Read/Write/Edit/Bash. The MCP tools give you:

### Project Discovery

| Tool                     | What it does                          |
| ------------------------ | ------------------------------------- |
| `vf_list_local_projects` | Find Veryfront projects on filesystem |
| `vf_list_examples`       | Browse example projects with features |

### Project Creation

| Tool                   | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `vf_list_templates`    | Available templates (ai, app, blog, docs, minimal) |
| `vf_list_integrations` | Service integrations (Gmail, Slack, GitHub, 50+)   |
| `vf_list_usecases`     | Pre-configured use-case bundles                    |
| `vf_create_project`    | Create new project from template                   |

### Development

| Tool                     | What it does                                     |
| ------------------------ | ------------------------------------------------ |
| `vf_get_errors`          | Real-time compile/runtime errors from dev server |
| `vf_preview_route`       | HTTP response without opening browser            |
| `vf_trigger_hmr`         | Force browser refresh after edits                |
| `vf_list_routes`         | Structured route manifest                        |
| `vf_scaffold`            | Generate correct boilerplate                     |
| `vf_get_project_context` | Project structure at a glance                    |

## Workflow

### New Project

```
1. vf_list_templates() → see what's available
2. vf_list_integrations() → browse integrations
3. vf_create_project({ name: "my-agent", template: "ai", integrations: ["gmail", "slack"] })
4. cd my-agent && deno task dev
```

### Development Loop

```
1. Edit file (use your Edit tool)
2. vf_get_errors() → check if it compiles
3. vf_preview_route({ route: "/path" }) → verify it works
4. vf_trigger_hmr() → update browser if needed
```

## File Conventions

```
app/
├── page.tsx              → /
├── layout.tsx            → wraps all pages
├── blog/
│   ├── page.tsx          → /blog
│   └── [slug]/
│       └── page.tsx      → /blog/:slug
├── api/
│   └── users/
│       └── route.ts      → GET/POST /api/users
└── (group)/              → no URL segment
    └── about/
        └── page.tsx      → /about
```

## Scaffolding

Generate files with correct conventions:

```
vf_scaffold({ type: "page", name: "Dashboard", slug: "dashboard" })
vf_scaffold({ type: "api", name: "Users", slug: "api/users", methods: ["GET", "POST"] })
vf_scaffold({ type: "layout", name: "Admin", slug: "admin" })
vf_scaffold({ type: "component", name: "UserCard" })
vf_scaffold({ type: "tool", name: "Search Products" })
vf_scaffold({ type: "agent", name: "Support Bot" })
```

## Templates

### Page

```tsx
export default function PageName() {
  return <div>Content</div>;
}
```

### Layout

```tsx
export default function LayoutName({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
```

### API Route

```ts
export function GET(req: Request) {
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const body = await req.json();
  return Response.json({ received: body });
}
```

### AI Tool

```ts
import { z } from "zod";

export const toolName = {
  name: "tool-name",
  description: "What it does",
  parameters: z.object({
    input: z.string(),
  }),
  execute: async ({ input }) => {
    return { result: input };
  },
};
```

## Debugging

```
vf_get_errors()                           → all errors
vf_get_errors({ type: "compile" })        → compile only
vf_get_errors({ file: "app/page.tsx" })   → specific file
vf_get_logs({ level: "error" })           → error logs
vf_clear_cache()                          → reset everything
```

## See Also

- [references/ROUTES.md](references/ROUTES.md) - Full routing docs
- [references/AI-TOOLS.md](references/AI-TOOLS.md) - AI tool patterns
- [references/COMPONENTS.md](references/COMPONENTS.md) - Component patterns
