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

Both runtime adapters capture application errors only. They disable Sentry
tracing, logs, request data, user data, and OpenTelemetry provider setup.
