---
title: "Workflow"
description: "How workflows coordinate multi-step work with durable progress."
order: 23
---

A workflow owns multi-step coordination. It can run ordered, branching, or
parallel steps and keep progress visible.

Use a workflow when work has multiple stages or needs durable state between
steps. Do not hide multi-step orchestration inside an agent prompt or a single
tool.

Workflows can call agents, tools, and approval steps. The workflow owns the
process. Each step owns its local work.

For implementation steps, see [Workflows](../guides/workflows.md).
