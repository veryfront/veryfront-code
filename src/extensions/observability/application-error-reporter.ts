import type { ApplicationErrorReporter } from "#veryfront/observability/application-error-contract.ts";

export type {
  ApplicationErrorContext,
  ApplicationErrorReporter,
} from "#veryfront/observability/application-error-contract.ts";

/** Runtime context passed to an explicitly selected reporter initializer. */
export type ApplicationErrorReporterInitializationContext = {
  serviceName: string;
};

/** Reporter and cleanup ownership returned by an application-selected initializer. */
export type ApplicationErrorReporterSession = {
  reporter: ApplicationErrorReporter;
  dispose(): void | Promise<void>;
};

/** Application-composition contract for an error-reporting implementation. */
export type ApplicationErrorReporterInitializer = {
  initialize(
    context: ApplicationErrorReporterInitializationContext,
  ):
    | ApplicationErrorReporterSession
    | undefined
    | Promise<ApplicationErrorReporterSession | undefined>;
};

/** Contract name used when an application composes a reporter through extensions. */
export const ApplicationErrorReporterInitializerName = "ApplicationErrorReporterInitializer";
