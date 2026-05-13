# Veryfront Architecture Diagrams

This directory contains Mermaid architecture diagrams that describe the internal structure of `veryfront-code`. These diagrams are intended as reference material for AI-assisted development and for onboarding contributors.

> **Note:** These diagrams describe the open-core runtime and framework architecture. Managed Veryfront Cloud behavior is called out explicitly where it matters.

## Diagram Index

| File                                                       | Description                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [01-system-overview.md](./01-system-overview.md)           | High-level system architecture, domains, and bridge modules                          |
| [02-request-pipeline.md](./02-request-pipeline.md)         | Request handling, server bootstrap, and rendering pipeline                           |
| [03-ai-agent-system.md](./03-ai-agent-system.md)           | AI capabilities, agent runtime, provider resolution, workflow engine, and memory     |
| [04-mcp-servers.md](./04-mcp-servers.md)                   | App MCP server and internal AG-UI transport                                          |
| [05-deployment-platform.md](./05-deployment-platform.md)   | Deployment platform, runtime adapters, filesystem resolution                         |
| [06-discovery-extensions.md](./06-discovery-extensions.md) | Auto-discovery engine, extension contracts, observability                            |
| [07-architecture-issues.md](./07-architecture-issues.md)   | Current architectural pressure points and strengthening directions                   |
| [08-support-matrix.md](./08-support-matrix.md)             | Router modes, runtime targets, and open-core vs service-backed capability boundaries |

## Key Architectural Concepts

### Extension System

Veryfront uses a contract-based extension system where capabilities are provided by first-party packages (`@veryfront/ext-*`). Each extension registers one or more contracts (e.g., `AuthProvider`, `Bundler`, `LLMProvider`) through a lifecycle of `setup(ctx)` / `teardown()`. Contracts are resolved lazily at first use with actionable error messages if missing. See [06-discovery-extensions.md](./06-discovery-extensions.md) for details.

### AG-UI Protocol

The agent system uses the AG-UI (Agent-User Interface) protocol for real-time streaming between agents and browser clients. This includes SSE transport, chunk encoding, event normalization, and browser response streaming. The control plane (`src/channels/`) routes agent requests with EdDSA-signed authentication.

### Multi-Tenant Isolation

Project-scoped registry managers (`src/registry/`) provide tenant isolation for tools, prompts, workflows, agents, and resources. Each project gets its own namespace, preventing cross-project leakage. This extends to the workflow engine where tenant context is captured, checkpointed, and restored across crash recovery.

## Related Documentation

- [src/README.md](../../src/README.md) — Module overview with dependency layers and import aliases
- [cli/README.md](../../cli/README.md) — CLI commands, structure, and adding new commands
- [src/workflow/README.md](../../src/workflow/README.md) — Workflow engine deep dive (checkpointing, job executors, multi-tenant)
- [extensions/](../../extensions/) — Individual extension READMEs with configuration and usage
