---
title: "Work"
description: "How Work defines business process outcomes and expectations."
order: 33
---

Work owns business process state. It gives agents, operators, and business users
a shared view of what should happen, what is currently running, and what evidence
has been recorded.

Use Work when the outcome matters independently of the automation path. An
agent, task, or workflow can decide how to pursue the outcome. The Work model
keeps the observable process state separate from that control flow.

## Work definition

A Work definition is the source-backed declaration of the business process.
Definitions live in `work/` and are discovered at startup.

- `id` is stable and project-local.
- `name` is the human-readable display name.
- `outcome` describes the desired business result.
- `expectations` are stable objects with IDs and descriptions.
- Expectations are required by default. Set `optional: true` only when the
  expectation should not block completion.

In `work/supplier-invoice-processing.ts`, export a definition with
`work({ id, name, outcome, expectations })`:

```ts
import { work } from "veryfront/work";

export default work({
  id: "supplier-invoice-processing",
  name: "Supplier invoice processing",
  outcome: "Resolve all open supplier invoices.",
  expectations: [
    {
      id: "invoices_discovered",
      description: "Open supplier invoices have been discovered.",
    },
    {
      id: "approved_invoices_scheduled",
      description: "Payment scheduling has been resolved for every payment-ready invoice.",
    },
    {
      id: "notify_finance_team",
      description: "Finance team has been notified when notification is required.",
      optional: true,
    },
  ],
});
```

## Work execution

A Work execution is a durable run of a Work definition. It records the current
status, input, state, summary, and per-expectation progress for one attempt to
make the outcome true.

Executions let agents update process state as work unfolds. For example, an
invoice-processing run can mark discovered invoices, record that a blocked
invoice is waiting on an owner, mark scheduled payments, and attach evidence to
each expectation.

## Work events

Work events are the timeline for a Work execution. Use events to record
observable process changes such as execution creation, process transitions,
specialist handoffs, expectation updates, evidence discrepancies, and final
summaries.

Events make the process auditable without forcing the Work definition to encode
every branch, retry, or tool call.

## Boundary

Work is not a workflow. A workflow owns automation logic such as sequence,
parallelism, retries, and branching. Work owns process observability: the
definition, execution status, expectations, evidence, and events.

The Work definition should not prescribe control flow. It should describe what
done means and which expectations prove that outcome.

## Agents

Agents can reference Work by ID with `agent({ work: "supplier-invoice-processing", ... })`.

The Work context is added to the agent system prompt so the agent understands
the outcome and expectations. Persistence of executions and events happens
through Work tools or APIs, not through the source definition itself.

For API details, see [veryfront/work](../api-reference/veryfront/work.md).
