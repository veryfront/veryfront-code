import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { sanitizeTelemetryAttributes, sanitizeTelemetryText } from "./telemetry-error.ts";
import { MAX_APPLICATION_ERROR_CONTEXT_VALUE_LENGTH } from "./limits.ts";
import {
  type ApplicationErrorReporterInitializer,
  ApplicationErrorReporterInitializerName,
  type ApplicationErrorReporterSession,
} from "#veryfront/extensions/observability/application-error-reporter.ts";
import type {
  ApplicationErrorContext,
  ApplicationErrorReporter,
} from "./application-error-contract.ts";

export type {
  ApplicationErrorReporterInitializationContext,
  ApplicationErrorReporterInitializer,
  ApplicationErrorReporterSession,
} from "#veryfront/extensions/observability/application-error-reporter.ts";
export type {
  ApplicationErrorAttributeValue,
  ApplicationErrorContext,
  ApplicationErrorReporter,
} from "./application-error-contract.ts";
export { ApplicationErrorReporterInitializerName };

/** Active application-error reporter ownership. */
export type ApplicationErrorReporterLifecycle = {
  readonly enabled: boolean;
  capture(error: unknown, context: ApplicationErrorContext): string | undefined;
  flush(timeoutMs?: number): Promise<boolean>;
  dispose(): Promise<void>;
};

const MAX_APPLICATION_ERROR_SERVICE_NAME_LENGTH = 255;

let reporter: ApplicationErrorReporter | undefined;
let reporterOwner: symbol | undefined;
let initializationGeneration = 0;
let activeLifecycle: ApplicationErrorReporterLifecycle | undefined;
let initializationQueue: Promise<void> = Promise.resolve();
let pendingInitializations = 0;

/**
 * Publish an unowned reporter directly, taking over from any active lifecycle.
 *
 * Direct replacement is a supported sequential handover: an active lifecycle
 * keeps its session and stays responsible for disposing it, but stops owning
 * the published reporter, so its capture/flush degrade to no-ops and its
 * dispose leaves the newly published reporter in place.
 *
 * Replacement during an in-flight initialization is rejected instead, because
 * that initialization publishes unconditionally once it settles and would
 * silently discard the reporter installed here.
 */
export function setApplicationErrorReporter(
  nextReporter: ApplicationErrorReporter | undefined,
): void {
  if (pendingInitializations > 0) {
    throw new Error(
      "Wait for the in-flight application-error initialization to settle before replacing its reporter",
    );
  }
  reporter = nextReporter;
  reporterOwner = undefined;
}

function disabledApplicationErrorReporterLifecycle(): ApplicationErrorReporterLifecycle {
  return Object.freeze({
    enabled: false,
    capture: () => undefined,
    flush: () => Promise.resolve(true),
    dispose: () => Promise.resolve(),
  });
}

function captureReporterSession(value: unknown): ApplicationErrorReporterSession {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Application-error reporter initializer must return a session object");
  }
  const session = value as Partial<ApplicationErrorReporterSession>;
  const sessionReporter = session.reporter;
  if (
    sessionReporter === null || typeof sessionReporter !== "object" ||
    typeof sessionReporter.capture !== "function" ||
    typeof sessionReporter.flush !== "function"
  ) {
    throw new TypeError("Application-error reporter session must contain a valid reporter");
  }
  const capture = sessionReporter.capture;
  const flush = sessionReporter.flush;
  const dispose = session.dispose;
  if (typeof dispose !== "function") {
    throw new TypeError("Application-error reporter session must provide dispose()");
  }

  return Object.freeze({
    reporter: Object.freeze({
      capture: (error: unknown, context: ApplicationErrorContext) => {
        const eventId = Reflect.apply(capture, sessionReporter, [error, context]);
        return typeof eventId === "string" ? eventId : undefined;
      },
      flush: (timeoutMs?: number) =>
        Promise.resolve(Reflect.apply(flush, sessionReporter, [timeoutMs])),
    }),
    dispose: () => Reflect.apply(dispose, session, []),
  });
}

function enqueueInitialization<T>(operation: () => Promise<T>): Promise<T> {
  pendingInitializations++;
  const result = initializationQueue.then(operation);
  initializationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result.finally(() => {
    pendingInitializations--;
  });
}

function snapshotApplicationErrorServiceName(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_APPLICATION_ERROR_SERVICE_NAME_LENGTH ||
    value.trim() !== value || value.normalize("NFC") !== value
  ) {
    throw new TypeError(
      `Application-error service name must be a canonical string of at most ${MAX_APPLICATION_ERROR_SERVICE_NAME_LENGTH} characters`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      throw new TypeError("Application-error service name cannot contain control characters");
    }
  }
  return value;
}

/**
 * Activate an explicitly selected reporter initializer.
 *
 * The latest initialization owns the process reporter. A superseded
 * initialization disposes the session it created instead of publishing stale
 * state. Provider initialization and disposal failures are not converted into
 * disabled/no-op behavior.
 */
export function initializeApplicationErrorReporter(options: {
  initializer?: ApplicationErrorReporterInitializer;
  serviceName: string;
}): Promise<ApplicationErrorReporterLifecycle> {
  const generation = ++initializationGeneration;
  const initializer = options.initializer;
  const requestedServiceName = options.serviceName;
  return enqueueInitialization(async () => {
    if (generation !== initializationGeneration) {
      return disabledApplicationErrorReporterLifecycle();
    }
    const serviceName = snapshotApplicationErrorServiceName(requestedServiceName);
    const previousLifecycle = activeLifecycle;
    if (previousLifecycle) await previousLifecycle.dispose();
    if (generation !== initializationGeneration) {
      return disabledApplicationErrorReporterLifecycle();
    }

    if (!initializer) {
      reporter = undefined;
      reporterOwner = undefined;
      return disabledApplicationErrorReporterLifecycle();
    }

    if (typeof initializer.initialize !== "function") {
      throw new TypeError("Application-error reporter initializer must provide initialize()");
    }
    const sessionValue = await Reflect.apply(initializer.initialize, initializer, [{
      serviceName,
    }]);
    if (sessionValue === undefined) {
      reporter = undefined;
      reporterOwner = undefined;
      return disabledApplicationErrorReporterLifecycle();
    }
    const session = captureReporterSession(sessionValue);

    if (generation !== initializationGeneration) {
      await session.dispose();
      return disabledApplicationErrorReporterLifecycle();
    }

    const owner = Symbol("application-error-reporter");
    reporter = session.reporter;
    reporterOwner = owner;
    let disposal: Promise<void> | undefined;
    const lifecycle: ApplicationErrorReporterLifecycle = Object.freeze({
      enabled: true,
      capture(error, context) {
        if (reporterOwner !== owner) return undefined;
        return captureApplicationError(error, context);
      },
      flush(timeoutMs) {
        if (reporterOwner !== owner) return Promise.resolve(true);
        return flushApplicationErrors(timeoutMs);
      },
      dispose() {
        if (disposal) return disposal;
        if (reporterOwner === owner) {
          reporter = undefined;
          reporterOwner = undefined;
        }
        disposal = Promise.resolve()
          .then(() => session.dispose())
          .finally(() => {
            if (activeLifecycle === lifecycle) activeLifecycle = undefined;
          });
        return disposal;
      },
    });
    activeLifecycle = lifecycle;
    return lifecycle;
  });
}

const TENANT_BUILD_ERROR_CLASS = "tenant-build";

/**
 * Tag applied by the module loader at the point of a compilation failure.
 *
 * The tag is read through the shared symbol registry instead of importing the
 * rendering layer; see src/rendering/orchestrator/module-loader/build-failure.ts.
 */
const BUILD_FAILURE_TAG = Symbol.for("veryfront.module-loader.build-failure");

/**
 * Whether `error` describes tenant build/content failing to compile (a page
 * that does not build, MDX that does not parse) rather than a framework fault.
 *
 * Recognizes the existing discriminators at their capture seam:
 * - the module loader's build-failure tag,
 * - `toError(createError({ type: "build" }))` structured error data,
 * - `VeryfrontError` instances in the BUILD category, and
 * - the render pipeline's `buildFailure` error context.
 */
function isTenantBuildError(error: unknown): boolean {
  try {
    if (error instanceof Error) {
      if ((error as { [BUILD_FAILURE_TAG]?: unknown })[BUILD_FAILURE_TAG] === true) {
        return true;
      }
      const descriptor = Object.getOwnPropertyDescriptor(error, "context");
      const data = descriptor && "value" in descriptor ? descriptor.value : undefined;
      if (
        typeof data === "object" && data !== null &&
        (data as { type?: unknown }).type === "build"
      ) {
        return true;
      }
    }
    const snapshot = snapshotVeryfrontError(error);
    if (!snapshot) return false;
    if (snapshot.category === "BUILD") return true;
    const errorContext = snapshot.context;
    return typeof errorContext === "object" && errorContext !== null &&
      (errorContext as { buildFailure?: unknown }).buildFailure === true;
  } catch {
    return false;
  }
}

export function captureApplicationError(
  error: unknown,
  context: ApplicationErrorContext,
): string | undefined {
  if (isExpectedApplicationError(error)) return undefined;
  const currentReporter = reporter;
  if (!currentReporter) return undefined;

  try {
    // Tenant build/content failures stay captured for escalation analysis,
    // but are tagged and downgraded so per-request tenant mistakes stop
    // surfacing as error-level framework issues.
    const classifiedContext = isTenantBuildError(error)
      ? {
        ...context,
        errorClass: context.errorClass ?? TENANT_BUILD_ERROR_CLASS,
        level: context.level ?? "warning" as const,
      }
      : context;
    const snapshot = snapshotApplicationErrorContext(classifiedContext);
    return snapshot ? currentReporter.capture(error, snapshot) : undefined;
  } catch {
    // Error reporting is diagnostic and must never replace the application
    // failure or response that led to this capture attempt.
    return undefined;
  }
}

export async function flushApplicationErrors(timeoutMs = 2_000): Promise<boolean> {
  const currentReporter = reporter;
  if (!currentReporter) return true;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    return false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  const pending = Promise.resolve()
    .then(() => currentReporter.flush(timeoutMs))
    .then((result) => result === true, () => false);

  try {
    return await Promise.race([pending, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function isExpectedApplicationError(error: unknown): boolean {
  try {
    if (error instanceof DOMException && error.name === "AbortError") return true;
    // Client-class (4xx) VeryfrontErrors describe caller or tenant content
    // (e.g. a rejected hosted config), not a server fault. They are still
    // logged at their throw sites; reporting them per request would flood the
    // error tracker with failures no code change here can fix.
    const snapshot = snapshotVeryfrontError(error);
    return snapshot !== null && snapshot.status >= 400 && snapshot.status < 500;
  } catch {
    return false;
  }
}

function snapshotApplicationErrorContext(
  context: ApplicationErrorContext,
): ApplicationErrorContext | null {
  if (context === null || typeof context !== "object") return null;
  const boundary = normalizeContextValue(context.boundary);
  if (!boundary) return null;

  const snapshot: ApplicationErrorContext = { boundary };
  for (
    const key of ["method", "processRole", "requestId", "spanId", "traceId", "errorClass"] as const
  ) {
    const value = context[key];
    if (value === undefined) continue;
    const normalized = normalizeContextValue(value);
    if (normalized) snapshot[key] = normalized;
  }
  if (context.level === "error" || context.level === "warning") {
    snapshot.level = context.level;
  }
  const attributes = sanitizeTelemetryAttributes(context.attributes);
  if (attributes && Object.keys(attributes).length > 0) {
    snapshot.attributes = Object.freeze(attributes);
  }
  return Object.freeze(snapshot);
}

function normalizeContextValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return sanitizeTelemetryText(
    value.trim(),
    MAX_APPLICATION_ERROR_CONTEXT_VALUE_LENGTH,
  );
}
