# Veryfront architecture

This folder documents the internal architecture of `veryfront-code`. Each page
explains runtime ownership, boundaries, protocols, and implementation shape for
one runtime concern. Architecture pages do not duplicate the user guides in
[docs/guides/](../guides/) or the public API reference in
[docs/api-reference/](../api-reference/).

## Section purpose

- Architecture pages describe how Veryfront works internally and where runtime
  boundaries sit.
- Architecture pages link to guides for user workflows.
- Architecture pages link to reference pages for public imports and APIs.
- Pages do not duplicate long API tables, full export maps, or tutorial
  walkthroughs.
- Concept names match code, schemas, guides, and reference docs.

## Page order

| File                                                                                         | Concern                                        |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [01-system-overview.md](./01-system-overview.md)                                             | System domains and bridge modules              |
| [02-request-pipeline.md](./02-request-pipeline.md)                                           | Request handling pipeline                      |
| [03-rendering-runtime.md](./03-rendering-runtime.md)                                         | Page rendering, SSR, RSC, and HTML assembly    |
| [04-server-runtime.md](./04-server-runtime.md)                                               | Dev and production server runtime              |
| [05-agent-runtime.md](./05-agent-runtime.md)                                                 | Agent execution, hosted runs, and primitives   |
| [06-ag-ui-transport.md](./06-ag-ui-transport.md)                                             | AG-UI browser transport                        |
| [07-provider-runtime.md](./07-provider-runtime.md)                                           | Provider, model, and embedding pipeline        |
| [08-workflow-runtime.md](./08-workflow-runtime.md)                                           | Workflow DAG execution                         |
| [09-runs-and-tasks.md](./09-runs-and-tasks.md)                                               | Runs client and task execution                 |
| [10-mcp-runtime.md](./10-mcp-runtime.md)                                                     | MCP server runtime                             |
| [11-control-plane-channels.md](./11-control-plane-channels.md)                               | Signed control-plane channels                  |
| [12-extension-system.md](./12-extension-system.md)                                           | Extension contracts and lifecycle              |
| [13-observability.md](./13-observability.md)                                                 | Metrics, traces, logs, profiling, and errors   |
| [14-build-pipeline.md](./14-build-pipeline.md)                                               | Production build, bundling, and assets         |
| [15-runtime-adapters.md](./15-runtime-adapters.md)                                           | Runtime adapter capability boundaries          |
| [16-discovery-and-registries.md](./16-discovery-and-registries.md)                           | Project primitive discovery and registries     |
| [17-sandbox-runtime.md](./17-sandbox-runtime.md)                                             | Sandbox session and command execution          |
| [18-oauth-runtime.md](./18-oauth-runtime.md)                                                 | OAuth provider, state, and token flow          |
| [19-integration-runtime.md](./19-integration-runtime.md)                                     | Integration catalog and remote tools           |
| [20-support-matrix.md](./20-support-matrix.md)                                               | Runtime and capability support matrix          |
| [21-agent-tool-registration-current-state.md](./21-agent-tool-registration-current-state.md) | Current agent tool and MCP registration review |
| [24-context-compaction-current-state.md](./24-context-compaction-current-state.md)           | Current Code and API compaction review         |
| [27-agent-message-stream-dataflow.md](./27-agent-message-stream-dataflow.md)                 | Agent prompt, stream, tool, and replay flow    |

## Runtime boundaries

The page set keeps these surfaces explicit and non-overlapping:

- CLI commands are documented in [cli/README.md](../../cli/README.md). They are
  not project runtime routes.
- Public app routes are owned by [server runtime](./04-server-runtime.md) and
  [rendering runtime](./03-rendering-runtime.md).
- Project runtime routes (`/api/runs*`, `/api/ag-ui`) are documented in
  [AG-UI transport](./06-ag-ui-transport.md) and
  [request pipeline](./02-request-pipeline.md).
- Service control-plane routes (`/api/control-plane/*`) are documented in
  [control-plane channels](./11-control-plane-channels.md).
- AG-UI streaming chunk encoding belongs in
  [AG-UI transport](./06-ag-ui-transport.md).
- Durable run state and child-run mirrors belong in
  [agent runtime](./05-agent-runtime.md).
- WebSocket notifications, hosted observability streams, and other control-plane
  channels are owned by [control-plane channels](./11-control-plane-channels.md).

## Page standard

Each focused page gives the reader enough context to make a safe change:

- Responsibility: what the boundary owns.
- Primary source areas: the code entrypoints to inspect first.
- Runtime or build flow: the execution sequence or lifecycle.
- Boundaries: what this page does not own.
- Change checks: the focused verification expected after a change.
- Related guides: the user guides that cover this boundary.
- Related reference: the public reference pages for the boundary's imports.

## Structure rules

- One file describes one runtime concern.
- Broad maps can link to focused pages, but they must not duplicate their
  implementation details.
- Runtime behavior, transport protocols, build output, and hosted control-plane
  behavior stay on separate pages.
- Architecture pages document implemented current state. Target-state designs,
  migration plans, and release plans belong outside this folder.
- Primary source areas use markdown links so GitHub readers can open the owning
  code directly.
- Add Mermaid diagrams only when they clarify ownership, branching, or sequence
  better than prose or tables.

## Update policy

When code changes cross a public boundary, update the guide or reference page
for the public behavior and the architecture page for the implementation
boundary. If a change touches more than one boundary, update each focused page
instead of expanding a broad overview. Run focused tests for the touched
runtime area. Broaden to full docs validation when docs, generated references,
or public exports change.

## Related documentation

- [src/README.md](../../src/README.md)
- [cli/README.md](../../cli/README.md)
- [src/workflow/README.md](../../src/workflow/README.md)
- [docs/guides/](../guides/)
- [docs/api-reference/](../api-reference/)
- [extensions/](../../extensions/)
