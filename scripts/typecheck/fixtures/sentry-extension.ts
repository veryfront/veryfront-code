import { createNodeSentryApplicationErrorReporter } from
  "@veryfront/ext-observability-sentry/node";

const reporter = createNodeSentryApplicationErrorReporter({
  dsn: "https://public@example.ingest.sentry.io/1",
  environment: "test",
  release: "test-release",
  serviceName: "veryfront-agent",
});

const eventId = reporter.capture(new Error("synthetic failure"), {
  boundary: "agent.process",
  traceId: "trace-1",
});

eventId?.toString();
void reporter.flush(1_500);
