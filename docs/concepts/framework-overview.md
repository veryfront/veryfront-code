---
title: "Framework architecture"
description: "How application routes, agents and execution primitives share one project."
order: 1
---

A Code project combines application routes, agent behavior and execution primitives. File conventions let the runtime discover their definitions.

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
