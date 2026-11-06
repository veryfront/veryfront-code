---
title: "Framework architecture"
description: "How application routes, agents and execution primitives share one project."
order: 1
---

A Veryfront project combines application routes, agent behavior and execution primitives. File conventions let the runtime discover their definitions.

## Main surfaces

| Area                 | What it gives you                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Pages and APIs       | React routes, MDX pages, data loading, and HTTP handlers.                                  |
| Agents and tools     | Model reasoning, tool calling, memory, AG-UI streaming, skills, and chat UI.               |
| Workflows and runs   | Durable multi-step execution, background tasks, schedules, and run history.                |
| Integrations and MCP | Connector-backed tools, OAuth, prompts, resources, and assistant-facing protocol surfaces. |

## Core idea

Routes receive requests from users and HTTP clients. Agents, tools, workflows
and tasks define work that routes and runtime services can reuse.
