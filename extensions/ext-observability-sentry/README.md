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
  reporter export.
- `@veryfront/ext-observability-sentry/deno` exports the explicit Deno reporter.
- `@veryfront/ext-observability-sentry/node` exports the explicit Node reporter.

The Node and Deno reporters share the same privacy policy, service tags,
`veryfront.boundary` tagging, Grafana trace correlation, fingerprinting, and
bounded flush behavior. They only use Sentry for error capture; tracing, logs,
request bodies, user data, and OpenTelemetry provider setup remain disabled.
