---
title: "Work"
description: "How Work defines business process outcomes and acceptance criteria."
order: 33
---

Work owns business process state. A Work definition names the outcome that
should become true and the acceptance criteria used to observe whether a run of
that work is complete.

Work exists because business users and operators need to see process state even
when the automation path is dynamic. An agent, task, or workflow can decide how
to pursue the outcome. The Work definition stays focused on what done means.

## Characteristics

- `id` is stable and project-local.
- `outcome` describes the desired business result.
- `acceptanceCriteria` are stable objects with IDs and descriptions.
- Criteria are required by default. Set `optional: true` only when the criterion
  should not block completion.
- Work definitions live in `work/` and are discovered at startup.

## Example

In `work/supplier-invoice-processing.ts`, export `work({ id, name, outcome,
acceptanceCriteria })`. Each acceptance criterion is an object such as
`{ id: "invoices_discovered", description: "Open supplier invoices have been discovered." }`.
Use `optional: true` only for criteria that should not block completion.

## Boundary

Work is not a workflow. A workflow owns automation logic such as sequence,
parallelism, retries, and branching. Work owns process observability: outcome,
criteria, execution status, evidence, and history.

For example, an invoice-processing agent can ingest invoices, call matching and
payment tools, skip criteria that are not applicable, and record events. The
Work definition should not prescribe that control flow.

## Agents

Agents can reference Work by ID with `agent({ work: "supplier-invoice-processing", ... })`.

The Work context is added to the agent system prompt so the agent understands
the outcome and criteria. Persistence of executions happens through Work tools
or APIs, not through the source definition itself.

For API details, see [veryfront/work](../api-reference/veryfront/work.md).
