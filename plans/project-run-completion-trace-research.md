# Project run completion tracing research

Installed framework rc22602 (9a4f39d) and reviewed candidate 1ac6aaa both create independent project_run.execute roots with signed project identity and caller links. Async OTLP withSpan intentionally does not infer success; its tests preserve callback-owned ERROR. API trace classification reports visible ERROR first, otherwise root status. Original readonly E2E requires samples of OK, UNSET and ERROR with detail agreement.

TaskRunResult.success explicitly means completed successfully. Workflow execution explicitly observes run.status === completed; success=true also represents waiting, so response.success alone is insufficient. Completion can be propagated internally, without adding wire fields, then admitted only after output validation and a non-aborted request.

Remaining design constraint: public Span has setStatus but no status getter. Explicit OK overrides ERROR in OpenTelemetry. A handler-local facade cannot intercept internal setActiveSpanErrorStatus because it acts on the raw span. Preserve callback-owned ERROR through a supported status-tracking helper rather than provider-specific status reads. This architectural choice must be settled before implementation.

RED: strengthen real handler completed-task test to demand exported root OK. Existing failure, throw, output-limit and caller-link tests remain. No target mutation or span fixture insertion.
