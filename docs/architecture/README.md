# Veryfront Architecture Diagrams

This directory contains Mermaid architecture diagrams that describe the internal structure of veryfront-code. These diagrams are intended as reference material for AI-assisted development and for onboarding contributors.

> **Note:** Veryfront is a full-stack framework that can be deployed to **any cloud provider** (not just Veryfront Cloud). It supports Deno, Node.js, Bun, and Cloudflare Workers runtimes.

## Diagram Index

| File | Description |
|------|-------------|
| [01-system-overview.md](./01-system-overview.md) | High-level system architecture and layer dependencies |
| [02-request-pipeline.md](./02-request-pipeline.md) | Request handling, server bootstrap, and rendering pipeline |
| [03-ai-agent-system.md](./03-ai-agent-system.md) | Agent runtime, provider resolution, workflow engine, memory |
| [04-mcp-servers.md](./04-mcp-servers.md) | App MCP server and Veryfront MCP (internal agents) |
| [05-deployment-platform.md](./05-deployment-platform.md) | Multi-cloud deployment, platform adapters, filesystem resolution |
| [06-discovery-extensions.md](./06-discovery-extensions.md) | Auto-discovery engine, extension contracts, observability |
