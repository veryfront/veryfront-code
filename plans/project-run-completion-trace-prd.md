# Project run completion tracing PRD

## Problem

A genuinely completed project task/workflow has an independent project_run.execute root, but the asynchronous compatibility wrapper leaves that root UNSET. Trace acceptance consequently lacks actual OK roots. A task may also report ERROR on that same active root before returning successfully; completion must not erase it.

## Required behavior

Mark an actual completed, validated, non-aborted task/workflow operation OK only when no execution ERROR was observed. Preserve explicit waiting, cancellation, thrown failures, rejected promises, output-limit failures, callback-owned ERROR, project identity, independent root and caller links. Keep public wire contracts and generic asynchronous withSpan behavior unchanged. Executors without explicit completed evidence remain unchanged.

## Outcome evidence

TaskRunResult.success documents successful completion, following the awaited task definition and output-schema processing. Workflow run.status === completed is explicit. Carry this internal evidence using an optional internal completion callback; do not infer it from the final response success flag, which also represents waiting.

## Approved architecture

The existing Span contract exposes only setStatus; no portable status read exists. Public facades hide provider-specific status. Framework internal error setters write directly to the provider span. Therefore a handler-local facade interceptor cannot prove that no prior ERROR was observed.

Independent architecture review approved Option A: add an opt-in monotonic completion helper backed by supported status observation at the public facade setter and internal error setter. This can preserve callback-owned ERROR, but requires independent architecture review and focused shim tests; it is broader than the originally requested handler-only diff. The approved implementation keeps this tracking private and changes no generic span completion semantics.

Option B: keep current UNSET behavior and report the telemetry contract limitation. This preserves all existing behavior but does not supply genuine completed OK roots.

Rejected: provider-specific status reads, blanket async-wrapper OK, setting OK before execution, synthetic spans, invalid traceparent, response-success-only inference, weakening E2E status requirements.

## Test plan

Real handler exporter: completed task and workflow OK; waiting remains UNSET; cancelled/aborted never OK; failures/throw/reject/output-limit remain ERROR; callback-marked ERROR remains ERROR despite successful return; unknown executor completion remains UNSET. Assert project attributes/root independence/caller links and no wire fields added. Run the narrow handler group, production typecheck and then relevant shim tests only if architecture option A is approved.

## Runtime qualification

No build/rollout before independent review. Then admit accurately joined final cohort and declared genuine exporter configuration. Invoke an owned native task/workflow, retain real completed execution evidence, wait the original five-minute historical cutoff and run unchanged trace-search acceptance. No fabricated traces or status edits.
