# Compose Sentry application-error reporting

Install `@veryfront/ext-observability-sentry` alongside `veryfront`. The core
package does not contain or automatically load a Sentry adapter.

For a Deno Veryfront application, add the extension factory to the project
configuration:

```ts
import extSentry from "@veryfront/ext-observability-sentry";
import { defineConfig } from "veryfront/config";

export default defineConfig({
  extensions: [extSentry()],
});
```

Provide the DSN to that process:

```sh
SENTRY_DSN=https://public@example.ingest.sentry.io/1
```

`SENTRY_DSN` does not activate reporting unless the extension is explicitly
composed. Invalid selected configuration, SDK initialization failures, and SDK
cleanup failures stop the owning startup or shutdown lifecycle.

For a Node agent host, import
`createNodeSentryApplicationErrorReporterInitializer` from
`@veryfront/ext-observability-sentry/node` and pass the returned initializer as
the host's `applicationErrorReporterInitializer` option.

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
