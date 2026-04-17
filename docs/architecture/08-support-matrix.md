# Support Matrix

This page keeps fast-moving support details short and explicit.

Use it for current support shape, not roadmap claims.

## Router Modes

Veryfront supports both router modes today.

| Mode | Primary file shapes | Notes |
|------|---------------------|-------|
| App router | `app/**/page.*`, `app/api/**/route.*` | Directory-based routing model. |
| Pages router | `pages/**`, `pages/api/**` | File-based routing model. |
| Router preference | `router: "app"` or `router: "pages"` in `veryfront.config.ts` | The preferred router can be configured explicitly. |
| Fallback behavior | If the preferred router directory is missing, Veryfront falls back to the other router when present | This is a runtime convenience, not a reason to mix router styles casually. |

## Runtime Targets

These are the runtime capability profiles currently modeled by the framework.

| Runtime | Filesystem | MCP server | Long-running agents/workflows | Notes |
|---------|------------|------------|-------------------------------|-------|
| Deno | Yes | Yes | Yes | Primary local/runtime target in this repo. |
| Node.js | Yes | Yes | Yes | Full runtime profile. |
| Bun | Yes | Yes | Yes | Full runtime profile. |
| Cloudflare Workers | No | No | Limited | Streaming is recommended; the runtime uses conservative step, CPU, and memory limits. |
| Unknown runtime | No | No | Limited | Falls back to a constrained compatibility profile. |

## Capability Boundaries

This matrix separates open-core framework support from capabilities that depend on a backing API or cloud bootstrap.

| Capability | Current support shape | Notes |
|------------|-----------------------|-------|
| Routing, rendering, middleware, API routes | Open-core | Core framework capability. |
| App MCP server | Open-core on runtimes that can host it | Not available on constrained runtimes like Cloudflare Workers. |
| Internal AG-UI transport | Open-core runtime surface | Separate from the app MCP contract. |
| Direct provider integrations (`openai`, `anthropic`, `google`, local) | Open-core with provider credentials/runtime setup | Depends on the selected provider configuration. |
| Veryfront Cloud model routing | Requires Veryfront Cloud bootstrap | Depends on project/auth context and cloud gateway configuration. |
| Veryfront Cloud blob storage | Requires Veryfront Cloud bootstrap | Uses project-scoped cloud upload APIs. |
| Jobs client | Requires backing API/service layer | Exposed as SDK/API surface, not as a built-in MCP jobs layer. |
| Sandbox | Requires backing API/service layer | Depends on authenticated sandbox session APIs. |
| Remote integration tools | Requires backing API/service layer | Tool definitions and execution are fetched per request from the configured API layer. |

## Documentation Rule

When a feature depends on a backing API, managed service, or cloud bootstrap, docs should say so directly instead of implying the open-core runtime provides the full managed behavior by itself.
