# `@veryfront/ext-observability-sentry`

First-party Sentry application error reporter for Veryfront runtimes.

The core runtime loads this package only when `SENTRY_DSN` is configured. It
captures unexpected application failures, tags them by service and boundary,
and keeps OpenTelemetry as the owner of traces, metrics, and logs.
