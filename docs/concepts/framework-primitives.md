---
title: "Framework primitives"
description: "How Veryfront Code apps, agents, tools, skills, prompts, resources, tasks, workflows, runs, integrations, MCP, sandbox, and extensions fit together."
order: 2
---

Veryfront Code uses primitives to separate responsibility. A primitive is an
ownership boundary: it names what kind of work is happening, what lifecycle owns
that work, and where the runtime boundary sits.

The goal is not to use every primitive. The goal is to pick the smallest one
that explains the work clearly.

## Primitives

| Primitive                               | Owns                                            |
| --------------------------------------- | ----------------------------------------------- |
| [App](./app.md)                         | User-facing routes, APIs, data, and rendering.  |
| [Agent](./agent.md)                     | Model reasoning, messages, tools, and output.   |
| [Tool](./tool.md)                       | One callable capability.                        |
| [Skill](./skill.md)                     | Reusable agent instructions and tool policy.    |
| [Prompt](./prompt.md)                   | Reusable instruction templates.                 |
| [Resource](./resource.md)               | Readable project data for MCP.                  |
| [Work](./work.md)                       | Business process outcomes and criteria.         |
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

This keeps the project understandable. The app owns entry points. Agents own
model decisions. Tools own deterministic actions. Work owns business process
state. Workflows own automation logic. Runs own durable execution. Extensions
own replaceable runtime infrastructure.

For task-focused selection, see [Choose a primitive](../guides/choose-a-primitive.md).
For exact agent runtime APIs, see
[veryfront/agent](../api-reference/veryfront/agent.md).
