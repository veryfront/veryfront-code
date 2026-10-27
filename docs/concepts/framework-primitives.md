---
title: "Framework primitives"
description: "How Veryfront Code apps, agents, tools, skills, prompts, resources, evals, tasks, workflows, runs, integrations, MCP, sandbox, and extensions fit together."
order: 2
---

Each primitive has one responsibility. Choose the smallest one that fits the work.

## Primitives

| Primitive                               | Owns                                            |
| --------------------------------------- | ----------------------------------------------- |
| [App](./app.md)                         | User-facing routes, APIs, data, and rendering.  |
| [Agent](./agent.md)                     | Model reasoning, messages, tools, and output.   |
| [Tool](./tool.md)                       | One callable capability.                        |
| [Skill](./skill.md)                     | Reusable agent instructions and resources.      |
| [Prompt](./prompt.md)                   | Reusable instruction templates.                 |
| [Resource](./resource.md)               | Readable project data for MCP.                  |
| [Eval](./eval.md)                       | Repeatable quality checks for agents.           |
| [Task](./task.md)                       | A background work target.                       |
| [Workflow](./workflow.md)               | Multi-step coordination.                        |
| [Run](./run.md)                         | Durable execution of work.                      |
| [Schedule](./schedule.md)               | Scheduled run creation.                         |
| [Integration](./integration.md)         | External service capabilities.                  |
| [MCP server](./mcp-server.md)           | Assistant-facing tools, prompts, and resources. |
| [Sandbox](./sandbox.md)                 | Isolated command and file execution.            |
| [Extensions](./framework-extensions.md) | Replaceable runtime infrastructure.             |

## How primitives combine

Features can combine primitives, but one primitive should own the triggering
event and primary lifecycle.

For example, an app route can receive a webhook. A workflow can coordinate the
response. A task can run slow background work. An agent can reason about a
user-facing decision. A skill can give the agent task-specific instructions.

For task-focused selection, see [Choose a primitive](../guides/choose-a-primitive.md).
For exact agent runtime APIs, see
[veryfront/agent](../api-reference/veryfront/agent.md).
