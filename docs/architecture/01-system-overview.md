# System overview

Veryfront Code is a Deno-first framework and runtime package for full-stack AI
apps. It combines application routing, rendering, native agent primitives,
workflow execution, MCP support, jobs, tasks, extensions, and deployment
runtime support.

This page is the domain map. Focused runtime and transport details live in the
linked architecture pages.

## Domains

| Domain                         | Source areas                                                                                 | Focused docs                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| App framework                  | `src/routing/`, `src/middleware/`, `src/react/`, `src/html/`, `src/data/`                    | [server runtime](./11-server-runtime.md), [rendering runtime](./12-rendering-runtime.md)                                                 |
| AI primitives                  | `src/agent/`, `src/tool/`, `src/prompt/`, `src/resource/`, `src/provider/`, `src/embedding/` | [agent runtime](./03-agent-runtime.md), [provider runtime](./04-provider-runtime.md), [embedding and RAG](./06-embedding-rag.md)         |
| Workflow and background work   | `src/workflow/`, `src/jobs/`, `src/task/`                                                    | [workflow runtime](./05-workflow-runtime.md)                                                                                             |
| Protocol surfaces              | `src/mcp/`, `src/agent/ag-ui/`, `src/channels/`                                              | [MCP runtime](./07-mcp-runtime.md), [AG-UI transport](./10-ag-ui-transport.md), [control-plane channels](./09-control-plane-channels.md) |
| Runtime platform               | `src/platform/`, `src/fs/`, `src/server/project-env/`                                        | [runtime adapters](./13-runtime-adapters.md)                                                                                             |
| Build system                   | `src/build/`, `src/transforms/`, `src/modules/`                                              | [build pipeline](./14-build-pipeline.md)                                                                                                 |
| Discovery and extension points | `src/discovery/`, `src/registry/`, `src/extensions/`                                         | [discovery and registries](./15-discovery-and-registries.md), [extension system](./16-extension-system.md)                               |
| Cross-cutting systems          | `src/security/`, `src/cache/`, `src/observability/`, `src/errors/`                           | [observability](./17-observability.md), [runtime boundaries](./19-runtime-boundaries.md)                                                 |

## Bridge modules

Some source areas intentionally connect domains:

- `src/chat/` connects UI components, agent streaming, and runtime hooks.
- `src/internal-agents/` connects Studio-facing agent surfaces with runtime
  primitives.
- `src/discovery/` connects project source files with registries.
- `src/server/` composes routing, rendering, protocols, static files, and
  runtime services.
- `src/build/` composes route collection, transforms, bundling, and production
  output.

Bridge modules should stay thin. When they grow domain-specific behavior, move
that behavior to the owning domain and keep the bridge as composition code.

## Dependency posture

- Shared contracts and utilities should stay broadly reusable.
- Runtime adapters should avoid owning app, agent, or workflow behavior.
- Entrypoints should compose domains instead of becoming hidden owners.
- Protocol surfaces should keep MCP, AG-UI, and control-plane channels separate.
- Public terminology should match the guide and reference docs.
