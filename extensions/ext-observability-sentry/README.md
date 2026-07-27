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
