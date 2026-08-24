import type {
  ApplicationErrorContext as CanonicalApplicationErrorContext,
} from "#veryfront/observability/application-error-contract.ts";
import {
  type ApplicationErrorContext,
  type ApplicationErrorReporterInitializer,
  ApplicationErrorReporterInitializerName,
} from "./index.ts";

type CanonicalFieldParity<TExtension, TCanonical> = [keyof TExtension] extends [keyof TCanonical]
  ? ([keyof TCanonical] extends [keyof TExtension] ? true : never)
  : never;

Deno.test("application-error initializer re-exports the canonical context contract", async () => {
  const fieldParity: CanonicalFieldParity<
    ApplicationErrorContext,
    CanonicalApplicationErrorContext
  > = true;
  if (!fieldParity) {
    throw new Error(
      "the extension entry point must re-export the canonical ApplicationErrorContext, not a local duplicate",
    );
  }

  // Annotated as a literal so excess-property checking fails the typecheck if
  // the re-exported context ever drops one of the canonical fields.
  const extensionContext: ApplicationErrorContext = {
    boundary: "worker.request",
    method: "POST",
    processRole: "worker",
    requestId: "req-1",
    spanId: "span-1",
    traceId: "trace-1",
    errorClass: "tenant-build",
    level: "error",
    attributes: { tenant: "acme", attempt: 2, retried: true },
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
