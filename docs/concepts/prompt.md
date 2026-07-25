---
title: "Prompt"
description: "How prompts define reusable instruction templates for MCP."
order: 27
---

A prompt owns reusable instruction text. It can include template variables and
can be exposed through MCP.

Prompts exist because assistants often need named instructions that are not
tools. A prompt tells an assistant what to do or how to frame a task. It does not
own executable capability or state. A generated prompt may run application code
to produce its text, but its public result is still instruction text; generators
should avoid side effects.

## Characteristics

- Content contains the instruction text.
- Variables fill named `{placeholder}` values supplied directly by the caller.
- A stable ID lets MCP clients discover the prompt.
- The caller decides when the prompt is useful.

Static content and generated content share the same contract: resolving a
prompt produces a string. Empty static content is still deliberate content, and
unresolved placeholders remain visible instead of being silently erased.
When both `content` and `generate` are configured, static content takes
precedence.

Variable values are inserted verbatim. Prompt interpolation does not claim to
sanitize untrusted text: blacklist rewriting is bypassable and can corrupt
legitimate input. Apply an explicit input policy at the trusted agent or
application boundary when variables come from an untrusted caller.

## Boundary

A prompt is read and applied by a caller. An agent or MCP client decides when to
use it. A tool owns an action. A resource owns readable data. A prompt owns
instructions.

This keeps instruction templates separate from executable capabilities.

## Wrong fit

Do not use a prompt when the project needs to fetch data, mutate state, or call
an external system. Use a resource for readable data and a tool for actions.

For API details, see [veryfront/prompt](../api-reference/veryfront/prompt.md).
