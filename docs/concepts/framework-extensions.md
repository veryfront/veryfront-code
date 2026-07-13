---
title: "Framework extensions"
description: "How extensions package runtime infrastructure behind contracts."
order: 7
---

An extension packages runtime infrastructure behind a contract. Use one when
multiple parts of a project need the same configured capability, such as auth,
cache, a model provider, observability, content parsing, schema validation, or
sandboxing.

An extension is not an app feature. App code asks for the contract. The
extension decides which package, provider, setup, and teardown back that
contract.

## What extensions own

- **Factory**: Turns configuration into an extension.
- **Contract**: Defines what app code uses.
- **Capabilities**: Declare runtime needs such as filesystem, network, environment,
  process, or sandbox access.
- **Lifecycle**: Opens resources during setup and releases them during teardown.
- **Presets**: Group extensions that load together.

## When to use extensions

Use an extension when a runtime capability has to be configured once and reused
behind the same interface. Veryfront discovers extension factories, orders
providers before consumers, runs setup, serves the app, and runs teardown in
reverse order.

Do not create an extension for code that belongs to one app route or one
feature. Use a normal project module for that.

For implementation steps, see [Extensions](../guides/extensions.md) and
[Author extensions](../guides/extension-authoring.md).

## Eval export and observability

Eval report export and runtime observability are separate extension surfaces.
Use `veryfront/extensions/eval` when a project needs to send completed
`EvalReport` payloads to an eval platform such as Braintrust, Langfuse, or
LangSmith. Use `@veryfront/ext-eval-report-http` for a generic HTTP transport
when a project wants one gateway endpoint instead of vendor SDKs. Use
`@veryfront/ext-eval-report-mlflow` when reports should be logged as MLflow
Tracking runs. Select the exporter id from the eval CLI with `--export mlflow`
or set `VERYFRONT_EVAL_EXPORTERS=mlflow` in CI; `MLFLOW_TRACKING_URI` activates
the extension without a project config entry. Use
`veryfront/extensions/observability` for runtime tracing, OpenTelemetry SDK
setup, spans, and monitoring.

Eval exporters receive redacted reports by default. Projects must explicitly
allow inputs, outputs, references, traces, metric evidence, metric explanations,
or record metadata before those fields leave the process. When OpenTelemetry is
active, `runEval` attaches the active `traceId` and `spanId` to export context
unless the caller passes an explicit trace context.

Exporter extensions should stay generic. Project-specific extraction, such as
turning a product ticket or model response into a classification label, belongs
in the eval adapter or metric. The MLflow exporter can aggregate classification
metrics only from safe metric evidence fields, and that evidence requires an
explicit redaction opt-in. Artifact transport is also part of the exporter
boundary: v1 supports HTTP(S) artifact roots and HTTP(S) MLflow artifact proxy
endpoints, not direct uploads to local filesystem roots or backend-specific
schemes such as `dbfs://`, `gs://`, or `wasbs://`.

Future vendor integrations should be sibling packages behind the same contract.
For example, Braintrust should be added as a separate
`@veryfront/ext-eval-report-*` exporter rather than as project-specific logic in
the MLflow exporter.
