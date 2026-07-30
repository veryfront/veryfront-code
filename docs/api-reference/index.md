---
title: "API reference"
sidebarTitle: "Overview"
description: "Veryfront Code API reference."
order: 1
---

## Contents

| Import | Description |
|--------|-------------|
| [`veryfront`](./veryfront/index.md) | Core app config and routing. |
| [`veryfront/agent`](./veryfront/agent.md) | Agents, AG-UI handlers, and memory. |
| [`veryfront/channels`](./veryfront/channels.md) | Signed control-plane and channel invocation contracts. |
| [`veryfront/chat`](./veryfront/chat.md) | Chat components and hooks. |
| [`veryfront/cli`](./veryfront/cli.md) | CLI runtime helpers. |
| [`veryfront/context`](./veryfront/context.md) | Page context. |
| [`veryfront/embedding`](./veryfront/embedding.md) | Embedding and retrieval helpers. |
| [`veryfront/errors`](./veryfront/errors.md) | Structured error system with slug-based registry, RFC 9457 HTTP problem details, error boundaries for HTTP and CLI, and user-friendly formatting. |
| [`veryfront/eval`](./veryfront/eval.md) | First-class eval primitives for agent quality checks. |
| [`veryfront/extensions`](./veryfront/extensions.md) | Extension contracts and loader helpers. |
| [`veryfront/fonts`](./veryfront/fonts.md) | Font components. |
| [`veryfront/fs`](./veryfront/fs.md) | Filesystem and path utilities. |
| [`veryfront/head`](./veryfront/head.md) | Document metadata components. |
| [`veryfront/integrations`](./veryfront/integrations.md) | Connector metadata and remote tools. |
| [`veryfront/knowledge`](./veryfront/knowledge.md) | Project knowledge retrieval helpers. |
| [`veryfront/markdown`](./veryfront/markdown.md) | Markdown rendering. |
| [`veryfront/mcp`](./veryfront/mcp.md) | MCP server helpers. |
| [`veryfront/mdx`](./veryfront/mdx.md) | MDX component overrides. |
| [`veryfront/metrics`](./veryfront/metrics.md) | Runtime/application metric hooks for project code. |
| [`veryfront/middleware`](./veryfront/middleware.md) | HTTP middleware. |
| [`veryfront/oauth`](./veryfront/oauth.md) | OAuth provider helpers. |
| [`veryfront/observability`](./veryfront/observability.md) | Tracing, metrics, errors, and logs. |
| [`veryfront/prompt`](./veryfront/prompt.md) | MCP prompt definitions. |
| [`veryfront/provider`](./veryfront/provider.md) | Model provider registry. |
| [`veryfront/release-assets`](./veryfront/release-assets.md) | Content-addressed release assets and manifest contracts. |
| [`veryfront/resource`](./veryfront/resource.md) | MCP resource definitions. |
| [`veryfront/router`](./veryfront/router.md) | Client navigation and route context. |
| [`veryfront/runs`](./veryfront/runs.md) | Canonical durable task and workflow runs. |
| [`veryfront/sandbox`](./veryfront/sandbox.md) | Isolated execution. |
| [`veryfront/schedule`](./veryfront/schedule.md) | Source-defined recurring schedules for Veryfront projects. |
| [`veryfront/schemas`](./veryfront/schemas.md) | Validation schemas. |
| [`veryfront/security`](./veryfront/security.md) | Security layer - input validation with size limits, CORS configuration, CSP and security headers, path traversal prevention, and secure filesystem access. |
| [`veryfront/server`](./veryfront/server.md) | Server runtime helpers. |
| [`veryfront/skill`](./veryfront/skill.md) | Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files using the Agent Skills metadata format and Veryfront's documented, fail-closed allowed-tools subset. YAML decoding is supplied by the `SkillDocumentParserProvider` extension contract. The CLI composes `@veryfront/ext-yaml` automatically; standalone parser calls pass a provider explicitly or use an active registration. |
| [`veryfront/task`](./veryfront/task.md) | Source-defined tasks for Veryfront projects. |
| [`veryfront/testing`](./veryfront/testing.md) | Test utilities. |
| [`veryfront/tool`](./veryfront/tool.md) | Tool definitions and execution. |
| [`veryfront/trigger`](./veryfront/trigger.md) | Shared source-trigger discovery and local execution primitives. |
| [`veryfront/ui`](./veryfront/ui.md) | UI primitives - the base layer for veryfront/chat components. |
| [`veryfront/utils`](./veryfront/utils.md) | Runtime utilities. |
| [`veryfront/webhook`](./veryfront/webhook.md) | Source-defined webhooks for Veryfront projects. |
| [`veryfront/workflow`](./veryfront/workflow.md) | Workflows. |
