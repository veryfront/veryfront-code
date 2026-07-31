# `@veryfront/ext-observability-sentry`

First-party Sentry application error reporter for Veryfront runtimes.

Enable the adapter explicitly and provide its credential:

```sh
VERYFRONT_ERROR_REPORTER=sentry
SENTRY_DSN=https://public@example.ingest.sentry.io/1
```

`SENTRY_DSN` alone does not activate reporting. Official compiled Veryfront
binaries include the dormant adapter; npm consumers install
`@veryfront/ext-observability-sentry` separately. The adapter captures
unexpected application failures, tags them by service and boundary, and keeps
OpenTelemetry as the owner of traces, metrics, and logs.

## Runtime entrypoints

- `@veryfront/ext-observability-sentry` keeps the V1 Deno-compatible root
  reporter export and the compatible `./deno` and `./node` subpaths. This
  package still depends on both Sentry SDKs for existing consumers.
- `@veryfront/ext-observability-sentry-deno` exports the Deno reporter with only
  `@sentry/deno`.
- `@veryfront/ext-observability-sentry-node` exports the Node reporter with only
  `@sentry/node`.

The Node and Deno reporters share the same privacy policy, service tags,
`veryfront.boundary` tagging, Grafana trace correlation, fingerprinting, and
bounded flush behavior. They only use Sentry for error capture; tracing, logs,
request bodies, user data, and OpenTelemetry provider setup remain disabled.

The runtime-specific packages do not require the `veryfront` package at runtime
or type-resolution time. They export the shared application-error declarations
(`ApplicationErrorContext` and `ApplicationErrorReporter`) from the same source
used by the framework reporter. Set `context.processRole` to preserve the
`process_role` Sentry tag used by dashboards and alerts. Host and server names
are not captured by default because they identify deployment infrastructure.
