# Veryfront Architecture Diagrams

This directory contains Mermaid architecture diagrams that describe the internal structure of `veryfront-code`. These diagrams are intended as reference material for AI-assisted development and for onboarding contributors.

> **Note:** `veryfront-code` is the open core of the Veryfront platform. Veryfront Cloud is the primary managed path, and the same runtime can also be self-hosted or deployed to other cloud environments.

## Diagram Index

| File | Description |
|------|-------------|
| [01-system-overview.md](./01-system-overview.md) | High-level system architecture, domains, and bridge modules |
| [02-request-pipeline.md](./02-request-pipeline.md) | Request handling, server bootstrap, and rendering pipeline |
| [03-ai-agent-system.md](./03-ai-agent-system.md) | AI capabilities, agent runtime, provider resolution, workflow engine, and memory |
| [04-mcp-servers.md](./04-mcp-servers.md) | App MCP server and internal AG-UI transport |
| [05-deployment-platform.md](./05-deployment-platform.md) | Deployment platform, runtime adapters, filesystem resolution |
| [06-discovery-extensions.md](./06-discovery-extensions.md) | Auto-discovery engine, extension contracts, observability |
| [07-architecture-issues.md](./07-architecture-issues.md) | Current architectural pressure points and strengthening directions |
