# Stream Lifecycle rollout and rollback

Operational runbook for rolling the Stream Lifecycle runtime fix out through
`VF_STREAM_LIFECYCLE_MODE` and for keeping hosted production on stream
protocol version 1 until the Phase 5 Stream Delivery design ships end to end.

## Gate table

| Stage                               | Mode                     | Minimum evidence                                                                                                      | Advance condition                                                                                              | Rollback                                                  |
| ----------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Build                               | `legacy`                 | focused and full verification in the implementation plan                                                              | all commands pass                                                                                              | revert the current task commit                            |
| Shadow                              | `shadow`                 | at least 10,000 attempts or 24 hours                                                                                  | zero unexplained divergence categories; no payload labels                                                      | set `VF_STREAM_LIFECYCLE_MODE=legacy`                     |
| Provider-executed tool finalization | `legacy` and `active`    | parallel provider calls produce one final result each; unresolved calls produce one explicit error in both modes      | exact-result, preliminary-result, missing-result, abort, and active-mode regressions pass                      | set `VF_STREAM_LIFECYCLE_MODE=legacy`                     |
| Active canary                       | `active` on 1 percent    | at least 1,000 attempts and one hour                                                                                  | no increase above 0.1 percentage points in failed/cancelled outcomes; timeout regression ends at policy budget | set mode to `legacy`                                      |
| Active ramp                         | 10, 50, then 100 percent | at least six hours at each step and 24 hours at 50 percent                                                            | deadline, cancellation, latency, and provider-family dashboards remain within the canary bounds                | set mode to `legacy` at the affected deployment scope     |
| Projection capability               | production version 1     | Gate 4 fixture suite                                                                                                  | version 2 Adapters have no production caller                                                                   | no action; writes remain version 1                        |
| Phase 5 cutover                     | version 2                | separately approved delivery plan, server metadata smoke test, backend dedupe, byte backpressure, mixed-source replay | all Phase 5 gates pass                                                                                         | stop version 2 creates; preserve existing versioned reads |

The legacy and active projections both terminate unresolved provider-executed
calls with an explicit error. The synthesized result remains outside runtime
continuation state, so it closes durable and live UI state without causing a
model retry or representing missing provider content as a success.

## Dashboards

Bounded dimensions only, from `<prefix>.stream.lifecycle.*`:

- `status`, `phase`, `error_code`, `cancellation_source`
- `provider`, `model_family` (normalized closed vocabularies)
- `deadline_kind`, `telemetry_kind`, `repair_code`
- `divergence_category`, `mode`

Duration histograms: attempt, first progress, semantic idle, tool input, and
provider-visible tool execution.

## Kill switch

`VF_STREAM_LIFECYCLE_MODE=legacy` restores the previous reader at any scope.
The legacy path keeps its own status wrapper at the runtime compatibility
boundary, so no provider redeploy is required.

## Watchdog deadline semantics follow the mode flag

`createChatStreamWatchdog()` derives its deadline semantics from
`VF_STREAM_LIFECYCLE_MODE` (overridable per-call via `strictDeadlines`):

- **`legacy` (default):** byte-compatible with the pre-lifecycle watchdog.
  Non-empty `message-metadata` chunks re-arm the deadline, and configured
  long-running tools run without a deadline.
- **`shadow` / `active`:** strict lifecycle semantics. All `message-metadata`
  and tool-call-status chunks are telemetry and never advance the deadline,
  and configured long-running tools run under the absolute
  `toolRunningTimeoutMs` cap (default 300 seconds).

Deploying this build with the flag unset changes no watchdog behavior. The
strict semantics — including the fix for streams kept alive only by
telemetry heartbeats — take effect when the mode advances to `shadow`, and
`VF_STREAM_LIFECYCLE_MODE=legacy` rolls them back at any scope.

## Incident evidence

Retain: the mode at incident time, the bounded outcome/deadline dashboards,
shadow divergence categories, and the diagnostic identifiers surfaced on
failed outcomes. Never log prompts, tool arguments, tool results, run IDs,
conversation IDs, cookies, authorization headers, or raw provider payloads.
