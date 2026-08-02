import type {
  ApplicationErrorContext as CanonicalApplicationErrorContext,
} from "#veryfront/observability/application-error-contract.ts";
import {
  type ApplicationErrorContext,
  type ApplicationErrorReporterInitializer,
  ApplicationErrorReporterInitializerName,
} from "./index.ts";

Deno.test("application-error initializer re-exports the canonical context contract", async () => {
  const extensionContext: ApplicationErrorContext = {
    boundary: "worker.request",
    processRole: "worker",
  };
  const canonicalContext: CanonicalApplicationErrorContext = extensionContext;
  const roundTripContext: ApplicationErrorContext = canonicalContext;
  let capturedProcessRole: string | undefined;

  const initializer: ApplicationErrorReporterInitializer = {
    initialize: () => ({
      reporter: {
        capture(_error, context) {
          capturedProcessRole = context.processRole;
          return "event-id";
        },
        flush: () => Promise.resolve(true),
      },
      dispose() {},
    }),
  };
  const session = await initializer.initialize({ serviceName: "worker" });
  if (!session) throw new Error("initializer unexpectedly disabled reporting");

  const eventId = session.reporter.capture(new Error("failed"), roundTripContext);
  if (eventId !== "event-id" || capturedProcessRole !== "worker") {
    throw new Error("canonical application-error context was not preserved");
  }
  if (ApplicationErrorReporterInitializerName !== "ApplicationErrorReporterInitializer") {
    throw new Error("application-error initializer contract name changed");
  }
});
