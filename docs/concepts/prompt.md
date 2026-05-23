---
title: "Prompt"
description: "How prompts define reusable instruction templates for MCP."
order: 27
---

A prompt owns reusable instruction text. It can include template variables and
can be exposed through MCP.

Prompts exist because assistants often need named instructions that are not
tools. A prompt tells an assistant what to do or how to frame a task. It does not
execute code and does not own state.

## Characteristics

- Content contains the instruction text.
- Variables let the caller fill in task-specific values.
- A stable ID lets MCP clients discover the prompt.
- The caller decides when the prompt is useful.

## Boundary

A prompt is read and applied by a caller. An agent or MCP client decides when to
use it. A tool owns an action. A resource owns readable data. A prompt owns
instructions.

This keeps instruction templates separate from executable capabilities.

## Wrong fit

Do not use a prompt when the project needs to fetch data, mutate state, or call
an external system. Use a resource for readable data and a tool for actions.

For API details, see [veryfront/prompt](../api-reference/veryfront/prompt.md).
