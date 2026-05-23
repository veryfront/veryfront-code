---
title: "Workflow"
description: "How workflows coordinate multi-step work with durable progress."
order: 23
---

A workflow owns multi-step coordination. It can run ordered, branching, or
parallel steps and keep progress visible.

Workflows exist because multi-step work needs structure outside a prompt. A
workflow makes the process visible: which step runs first, which branches exist,
what can retry, and where approval can happen.

## Characteristics

- Steps describe the units of work.
- Branches describe alternate paths.
- Parallel steps allow independent work to run together.
- State keeps progress visible across the process.
- Approvals make human decision points explicit.

## Boundary

Workflows can call agents, tools, and approval steps. The workflow owns the
process. Each step owns its local work.

Use a workflow when work has multiple stages or needs durable state between
steps. Do not hide multi-step orchestration inside an agent prompt or a single
tool.

## Wrong fit

Do not use a workflow when one route, one tool, or one agent turn is enough.
Workflow structure should make a real process clearer, not add ceremony.

For implementation steps, see [Workflows](../guides/workflows.md).
