---
title: "Concepts"
sidebarTitle: "Overview"
description: "How Veryfront framework primitives, conventions, and runtime fit together."
order: 0
---

Concepts explain how Veryfront Code is organized and where each primitive
belongs. Start here when ownership, lifecycle, or framework boundaries are not
clear.

## Contents

| Concept                                             | Explains                                                   |
| --------------------------------------------------- | ---------------------------------------------------------- |
| [Veryfront Code](./framework-overview.md)           | How the main framework surfaces fit together.              |
| [Framework primitives](./framework-primitives.md)   | Overview of framework primitives.                          |
| [App](./app.md)                                     | The user-facing route and rendering boundary.              |
| [Agent](./agent.md)                                 | The model reasoning loop and output boundary.              |
| [Tool](./tool.md)                                   | The contract for one callable capability.                  |
| [Skill](./skill.md)                                 | How skills package reusable agent instructions.            |
| [Prompt](./prompt.md)                               | Reusable instruction templates for MCP.                    |
| [Resource](./resource.md)                           | Read-only context exposed through MCP.                     |
| [Eval](./eval.md)                                   | Repeatable quality checks for agents.                      |
| [Work](./work.md)                                   | Business process outcomes and criteria.                    |
| [Task](./task.md)                                   | Background work before it becomes a run.                   |
| [Workflow](./workflow.md)                           | Multi-step work with visible process state.                |
| [Run](./run.md)                                     | Durable records for background execution.                  |
| [Schedule](./schedule.md)                           | Triggers that create runs.                                 |
| [Integration](./integration.md)                     | External service access, auth, and remote tools.           |
| [MCP server](./mcp-server.md)                       | Tools, prompts, and resources exposed to assistants.       |
| [Sandbox](./sandbox.md)                             | Isolated command and file execution.                       |
| [Framework conventions](./framework-conventions.md) | File layout, auto-discovery, shared code, content, config. |
| [Framework extensions](./framework-extensions.md)   | Replaceable runtime infrastructure.                        |
