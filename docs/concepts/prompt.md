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

Direct application calls may pass any JavaScript values in the variables
record; interpolation converts non-null values to text. MCP is a narrower
transport contract: prompt argument values must be strings. When a prompt
declares MCP arguments, the server rejects missing required arguments,
undeclared arguments, and non-string values before rendering.

## MCP metadata

The optional `mcp` field controls only MCP exposure and presentation:

- `enabled: false` keeps the prompt available to application code but excludes
  it from MCP listing and retrieval.
- `title` supplies the human-readable MCP title.
- `arguments` documents accepted names, titles, descriptions, and whether each
  value is required.

Argument names must be unique. Metadata is validated and snapshotted when the
prompt crosses the factory or registry boundary, so later caller mutation
cannot silently change the advertised contract.

Auto-discovery derives IDs relative to the configured prompt directory.
`prompts/admin/review-message.ts` becomes `admin/reviewMessage`, and
`prompts/admin/index.ts` becomes `admin`. This retains the directory namespace
instead of allowing same-named nested files to overwrite one another.

## Cancellation and deadlines

A generated prompt receives an optional second argument with an
`abortSignal` and absolute millisecond `deadline`. MCP cancellation is
propagated through that signal. The caller is released promptly when
cancellation or the deadline wins, even if a generator ignores the signal.

The signal remains cooperative for the generator's own work: generators should
pass it to cancellable I/O and stop side effects when it aborts. Returning to
the caller cannot forcibly terminate arbitrary JavaScript that the generator
already started.

## Boundary

A prompt is read and applied by a caller. An agent or MCP client decides when to
use it. A tool owns an action. A resource owns readable data. A prompt owns
instructions.

This keeps instruction templates separate from executable capabilities.

## Wrong fit

Do not use a prompt when the project needs to fetch data, mutate state, or call
an external system. Use a resource for readable data and a tool for actions.

For API details, see [veryfront/prompt](../api-reference/veryfront/prompt.md).
