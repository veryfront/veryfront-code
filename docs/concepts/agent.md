---
title: "Agent"
description: "How agents own model reasoning, messages, tools, memory, and streamed output."
order: 21
---

An agent owns model reasoning for an interaction. It receives messages, applies
instructions, calls tools, uses memory, and emits output.

Use an agent when the system needs to decide what to say or which tool to call.
Do not use an agent for deterministic work that a tool, route, task, or workflow
can own directly.

Agents usually pair with tools, memory, and a chat UI. AG-UI is the default
streaming surface for interactive agent output.

For implementation steps, see [Agents](../guides/agents.md).
