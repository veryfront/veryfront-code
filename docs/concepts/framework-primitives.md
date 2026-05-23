---
title: "Framework primitives"
description: "How Veryfront Code agents, tools, workflows, tasks, jobs, integrations, MCP, sandbox, and extensions fit together."
order: 2
---

Veryfront Code uses primitives to separate responsibility. Each primitive owns a
specific kind of work, lifecycle, and runtime boundary.

## Primitives

| Primitive                                         | Owns                                            |
| ------------------------------------------------- | ----------------------------------------------- |
| [Agent](./agent.md)                               | Model reasoning, messages, tools, and output.   |
| [Tool](./tool.md)                                 | One callable capability.                        |
| [Workflow](./workflow.md)                         | Multi-step coordination.                        |
| [Task](./task.md)                                 | A background work target.                       |
| [Job](./job.md)                                   | Durable execution of work.                      |
| [Cron job](./cron-job.md)                         | Scheduled job creation.                         |
| [Integration](./integration.md)                   | External service capabilities.                  |
| [MCP server](./mcp-server.md)                     | Assistant-facing tools, prompts, and resources. |
| [Sandbox](./sandbox.md)                           | Isolated command and file execution.            |
| [Framework extensions](./framework-extensions.md) | Replaceable runtime infrastructure.             |

## Ownership boundaries

Features can combine primitives, but one primitive should own the triggering
event and primary lifecycle.

For example, an API route can receive a webhook. A workflow can coordinate the
response. A task can run slow background work. An agent can reason about a
user-facing decision.
