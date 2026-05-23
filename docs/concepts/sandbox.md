---
title: "Sandbox"
description: "How sandboxes isolate command and file execution."
order: 29
---

A sandbox owns isolated command and file execution. It gives agents, tools, or
workflows a controlled place to run code.

Use a sandbox when execution should be separated from the host process. This is
useful for generated code, project inspection, tests, and command execution.

The sandbox owns process and file isolation. The caller owns why the command
runs.

For implementation steps, see [Sandbox](../guides/sandbox.md).
