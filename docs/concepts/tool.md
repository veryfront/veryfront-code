---
title: "Tool"
description: "How tools expose one typed capability to agents, workflows, or MCP servers."
order: 22
---

A tool owns one callable capability. It defines input, output, and execution.

Use a tool when a model or workflow needs to call deterministic code. Keep tools
focused. A tool should do one thing and return a clear result.

Tools can be local project files, remote integration tools, or MCP-exposed
capabilities. The caller chooses when to invoke them. The tool owns how the work
runs.

For implementation steps, see [Tools](../guides/tools.md).
