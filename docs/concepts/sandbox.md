---
title: "Sandbox"
description: "How sandboxes isolate command and file execution."
order: 32
---

A sandbox owns isolated command and file execution. It gives agents, tools, or
workflows a controlled place to run code.

Sandboxes exist because some work should not run directly in the app process.
Generated code, project inspection, tests, and command execution need a
controlled boundary.

## Characteristics

- Filesystem access is scoped to the sandbox.
- Commands run outside the app process.
- Streaming output can report progress.
- Background commands can continue after the caller starts them.

## Boundary

The sandbox owns process and file isolation. The caller owns why the command
runs.

Use a sandbox when execution should be separated from the host process. Agents,
tools, and workflows can use the sandbox, but they do not own its isolation
model.

## Wrong fit

Do not use a sandbox as a general application module boundary. Use it when
execution isolation is the point.

For implementation steps, see [Sandbox](../guides/sandbox.md).
