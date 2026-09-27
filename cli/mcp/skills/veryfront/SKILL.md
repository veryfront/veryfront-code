---
name: veryfront
description: Build Veryfront apps. Use for real-time errors, route preview, HMR control, and scaffolding pages/APIs/components/AI tools.
license: Apache-2.0
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
| `vf_list_templates`      | Browse project templates              |
| `vf_list_integrations`   | Browse service integrations           |

### Project Creation

| Tool                | What it does                          |
| ------------------- | ------------------------------------- |
| `vf_create_project` | Create a new project from a template  |
| `vf_scaffold`       | Generate files in an existing project |

### Development

| Tool                     | What it does                                     |
| ------------------------ | ------------------------------------------------ |
| `vf_get_errors`          | Real-time compile/runtime errors from dev server |
| `vf_preview_route`       | HTTP response without opening browser            |
| `vf_trigger_hmr`         | Force browser refresh after edits                |
| `vf_list_routes`         | Structured route manifest                        |
| `vf_scaffold`            | Generate correct boilerplate                     |
| `vf_get_project_context` | Project structure at a glance                    |
| `vf_run_tests`           | Run the project's test suite                     |
| `vf_run_lint`            | Run the linter                                   |

## Workflow

### New Project

```
1. vf_list_templates()
2. vf_create_project({ name: "research-agent", template: "ai-agent" })
3. cd research-agent && deno task dev
```

### Example: add an agent

```
1. vf_bootstrap()
2. vf_get_conventions({ topic: "ai" })
3. vf_scaffold({ type: "agent", name: "research-agent" })
4. vf_scaffold({ type: "tool", name: "search-docs" })
5. vf_scaffold({ type: "skill", name: "research" })
6. vf_get_errors()
7. vf_run_lint()
```

The research-agent names are examples. Use names that match the app domain.

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
vf_scaffold({ type: "page", name: "dashboard" })
vf_scaffold({ type: "api", name: "api/users", methods: ["GET", "POST"] })
vf_scaffold({ type: "layout", name: "admin" })
vf_scaffold({ type: "component", name: "UserCard" })
vf_scaffold({ type: "tool", name: "search-docs" })
vf_scaffold({ type: "agent", name: "research-agent" })
vf_scaffold({ type: "skill", name: "research" })
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
import { defineSchema } from "veryfront/schemas";

export const toolName = {
  name: "tool-name",
  description: "What it does",
  parameters: defineSchema((v) =>
    v.object({
      input: v.string(),
    })
  )(),
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
vf_run_lint()                             → lint the project
vf_run_tests()                            → run the test suite
```

## Integrations

Provider tools such as `gmail__list_emails` run through a connected account.
`veryfront login` signs you in to Veryfront; `veryfront integration connect`
authorizes a provider account and needs a person in a browser. Always pass the
project. Check `credential_requirement.mode` with
`veryfront integration get "<NAME>" --project "<PROJECT_SLUG>" --json` first. For
`oauth_connection`, select the connection from inventory:

```
veryfront integration tools gmail --project "<PROJECT_SLUG>" --json
veryfront integration connections gmail --project "<PROJECT_SLUG>" --json
veryfront integration call gmail__list_emails --project "<PROJECT_SLUG>" --connection "<CONNECTION_ID>" --expected-generation "<CONNECTION_GENERATION_ID>" --args '{"q":"in:inbox","maxResults":1}' --json
```

For `project_credentials` connectors (API key, Basic, client credentials), call
with `--project` only; they have no connection inventory.

Call once. Never repeat a write whose outcome is unknown, never switch accounts,
and never handle provider secrets in chat. See
[references/INTEGRATIONS.md](references/INTEGRATIONS.md) for readiness, other
surfaces, and recovery.

## See Also

- [references/ROUTES.md](references/ROUTES.md) - Full routing docs
- [references/AI-TOOLS.md](references/AI-TOOLS.md) - AI tool patterns
- [references/COMPONENTS.md](references/COMPONENTS.md) - Component patterns
- [references/INTEGRATIONS.md](references/INTEGRATIONS.md) - Integration calls and recovery
