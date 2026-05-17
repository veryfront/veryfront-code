# Veryfront architecture

This folder documents the internal architecture of `veryfront-code`. Each page
owns one boundary so docs stay easier to update when code changes.

## Structure rule

- One file describes one architectural concern.
- Broad maps can link to focused pages, but they must not duplicate their
  implementation details.
- Runtime behavior, transport protocols, build output, and hosted control-plane
  behavior stay on separate pages.

## Architecture outline

| File                                                               | Concern                                      |
| ------------------------------------------------------------------ | -------------------------------------------- |
| [01-system-overview.md](./01-system-overview.md)                   | System domains and bridge modules            |
| [02-request-pipeline.md](./02-request-pipeline.md)                 | Request handling pipeline                    |
| [03-agent-runtime.md](./03-agent-runtime.md)                       | Agent execution boundary                     |
| [04-provider-runtime.md](./04-provider-runtime.md)                 | Provider and model resolution                |
| [05-workflow-runtime.md](./05-workflow-runtime.md)                 | Workflow DAG execution                       |
| [06-embedding-rag.md](./06-embedding-rag.md)                       | Embedding, chunking, and retrieval           |
| [07-mcp-runtime.md](./07-mcp-runtime.md)                           | MCP server runtime                           |
| [08-hosted-agent-runs.md](./08-hosted-agent-runs.md)               | Hosted agent run state and child runs        |
| [09-control-plane-channels.md](./09-control-plane-channels.md)     | Signed control-plane channels                |
| [10-ag-ui-transport.md](./10-ag-ui-transport.md)                   | AG-UI browser transport                      |
| [11-server-runtime.md](./11-server-runtime.md)                     | Dev and production server runtime            |
| [12-rendering-runtime.md](./12-rendering-runtime.md)               | Page rendering, SSR, RSC, and HTML assembly  |
| [13-runtime-adapters.md](./13-runtime-adapters.md)                 | Runtime adapter capability boundaries        |
| [14-build-pipeline.md](./14-build-pipeline.md)                     | Production build, bundling, and assets       |
| [15-discovery-and-registries.md](./15-discovery-and-registries.md) | Project primitive discovery and registries   |
| [16-extension-system.md](./16-extension-system.md)                 | Extension contracts and lifecycle            |
| [17-observability.md](./17-observability.md)                       | Metrics, traces, logs, profiling, and errors |
| [18-support-matrix.md](./18-support-matrix.md)                     | Runtime and capability support matrix        |
| [19-runtime-boundaries.md](./19-runtime-boundaries.md)             | High-risk boundary change checklist          |

## Update policy

When code changes cross a public boundary, update the guide or reference page
for the public behavior and the architecture page for the implementation
boundary. If a change touches more than one boundary, update each focused page
instead of expanding a broad overview.

## Related documentation

- [src/README.md](../../src/README.md)
- [cli/README.md](../../cli/README.md)
- [src/workflow/README.md](../../src/workflow/README.md)
- [extensions/](../../extensions/)
