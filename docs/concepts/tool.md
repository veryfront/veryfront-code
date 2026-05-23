---
title: "Tool"
description: "How tools expose one typed capability to agents, workflows, or MCP servers."
order: 22
---

A tool owns one callable capability. It defines input, output, and execution.

Tools exist because agents and workflows need safe ways to act. The model can
choose a tool, but the tool owns the deterministic code that runs.

## Characteristics

- Typed input describes what the caller must provide.
- Execution performs one operation.
- Output returns a structured result the caller can use.
- Errors describe why the operation could not complete.

## Boundary

Tools can be local project files, remote integration tools, or MCP-exposed
capabilities. The caller chooses when to invoke them. The tool owns how the work
runs.

Keep tools focused. A tool should do one thing, validate its input, and return a
clear result. If the operation grows into multiple stages, approvals, or retries,
move the coordination into a workflow.

## Wrong fit

Do not use a tool as a hidden workflow, long-running job, or large integration
layer. Use a workflow for process, a job for durable execution, and an
integration for reusable external service access.

For implementation steps, see [Tools](../guides/tools.md).
