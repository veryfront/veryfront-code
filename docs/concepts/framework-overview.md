---
title: "Veryfront Code"
description: "An AI framework to build AI apps and agents."
order: 1
---

Veryfront Code is an AI framework for building AI apps and agents in TypeScript
and React. It treats apps, agents, tools,
workflows, tasks, runs, prompts, resources, skills, integrations, MCP servers,
sandboxes, and extensions as framework primitives with shared project
conventions.

The framework exists because AI applications need normal app surfaces and AI
runtime surfaces to cooperate. A chat page, an AG-UI route, an agent, a tool,
and a deployment target are separate concerns that belong in the same
discoverable project.

## Main surfaces

| Area                 | What it gives you                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Pages and APIs       | React routes, MDX pages, data loading, and HTTP handlers.                                  |
| Agents and tools     | Model reasoning, tool calling, memory, AG-UI streaming, skills, and chat UI.               |
| Workflows and runs   | Durable multi-step execution, background tasks, schedules, and run history.                |
| Integrations and MCP | Connector-backed tools, OAuth, prompts, resources, and assistant-facing protocol surfaces. |

## Core idea

The shared project model matters more than any single primitive. Routes decide
how users and HTTP clients enter the system. Agents, tools, workflows, tasks,
runs, prompts, resources, skills, integrations, and sandboxes define
capabilities that routes and runtime services can reuse.
