import { serverLogger } from "#veryfront/utils";
import type { Context, OpenTelemetryAPI, Span, TextMapPropagator } from "./types.ts";
import { classifyTelemetryError } from "../telemetry-safety.ts";

const logger = serverLogger.component("tracing");
const MAX_PROPAGATION_FIELDS = 32;
const MAX_PROPAGATION_VALUE_LENGTH = 8_192;
const DEFAULT_PROPAGATION_FIELDS = ["traceparent", "tracestate", "baggage"] as const;
const SAFE_HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
]);

function logPropagationFailure(message: string, error: unknown): void {
  try {
    logger.debug(message, { failure_category: classifyTelemetryError(error) });
  } catch {
    // Logging must not affect application behavior.
  }
}

type OperationOutcome<T> =
  | { state: "pending" }
  | { state: "resolved"; value: T }
  | { state: "rejected"; error: unknown };

function createSingleInvocation<T>(fn: () => T): {
  invoke(): T;
  getOutcome(): OperationOutcome<T>;
} {
  let outcome: OperationOutcome<T> = { state: "pending" };
  return {
    invoke(): T {
      if (outcome.state === "resolved") return outcome.value;
      if (outcome.state === "rejected") throw outcome.error;
      try {
        const value = fn();
        outcome = { state: "resolved", value };
        return value;
      } catch (error) {
        outcome = { state: "rejected", error };
        throw error;
      }
    },
    getOutcome: () => outcome,
  };
}

function createSingleAsyncInvocation<T>(fn: () => Promise<T>): {
  invoke(): Promise<T>;
  getOutcome(): OperationOutcome<T>;
} {
  let outcome: OperationOutcome<T> = { state: "pending" };
  let operation: Promise<T> | undefined;
  return {
    invoke(): Promise<T> {
      operation ??= (async () => {
        try {
          const value = await fn();
          outcome = { state: "resolved", value };
          return value;
        } catch (error) {
          outcome = { state: "rejected", error };
          throw error;
        }
      })();
      return operation;
    },
    getOutcome: () => outcome,
  };
}

export class ContextPropagation {
  constructor(
    private api: OpenTelemetryAPI,
    private propagator: TextMapPropagator,
  ) {}

  extractContext(headers: Headers): Context | undefined {
    try {
      const fields = new Set<string>(DEFAULT_PROPAGATION_FIELDS);
      try {
        for (const field of this.propagator.fields()) {
          if (fields.size >= MAX_PROPAGATION_FIELDS) break;
          if (isSafePropagationHeader(field)) fields.add(field.toLowerCase());
        }
      } catch {
        // Standard W3C fields remain available when a custom propagator fails.
      }

      const carrier = Object.create(null) as Record<string, string>;
      for (const field of fields) {
        const value = headers.get(field);
        if (value !== null && value.length <= MAX_PROPAGATION_VALUE_LENGTH) {
          carrier[field] = value;
        }
      }
      return this.api.propagation.extract(this.api.context.active(), carrier);
    } catch (error) {
      logPropagationFailure("Failed to extract context from headers", error);
      return undefined;
    }
  }

  injectContext(context: Context, headers: Headers): void {
    try {
      const carrier = Object.create(null) as Record<string, string>;
      this.api.propagation.inject(context, carrier);

      let count = 0;
      for (const [key, value] of Object.entries(carrier)) {
        if (count >= MAX_PROPAGATION_FIELDS) break;
        if (
          !isSafePropagationHeader(key) || typeof value !== "string" ||
          value.length > MAX_PROPAGATION_VALUE_LENGTH || /[\r\n]/.test(value)
        ) {
          continue;
        }
        headers.set(key, value);
        count++;
      }
    } catch (error) {
      logPropagationFailure("Failed to inject context into headers", error);
    }
  }

  getActiveContext(): Context | undefined {
    try {
      return this.api.context.active();
    } catch (error) {
      logPropagationFailure("Failed to get active context", error);
      return undefined;
    }
  }

  async withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T> {
    if (!span) return fn();

    const invocation = createSingleAsyncInvocation(fn);
    try {
      return await this.api.context.with(
        this.api.trace.setSpan(this.api.context.active(), span),
        invocation.invoke,
      );
    } catch {
      const outcome = invocation.getOutcome();
      if (outcome.state === "resolved") return outcome.value;
      if (outcome.state === "rejected") throw outcome.error;
      return await invocation.invoke();
    }
  }

  withSpan<T>(
    name: string,
    fn: (span: Span | null) => T,
    startSpan: (name: string) => Span | null,
    endSpan: (span: Span | null, error?: unknown) => void,
  ): T {
    let span: Span | null;
    try {
      span = startSpan(name);
    } catch {
      return fn(null);
    }
    const invocation = createSingleInvocation(() => fn(span));
    let ended = false;
    const endOnce = (): void => {
      if (ended) return;
      ended = true;
      const outcome = invocation.getOutcome();
      try {
        endSpan(span, outcome.state === "rejected" ? outcome.error : undefined);
      } catch {
        // Telemetry must not affect application behavior.
      }
    };

    try {
      const activeContext = this.api.context.active();
      const spanContext = span ? this.api.trace.setSpan(activeContext, span) : activeContext;
      return this.api.context.with(spanContext, invocation.invoke);
    } catch {
      const outcome = invocation.getOutcome();
      if (outcome.state === "resolved") return outcome.value;
      if (outcome.state === "rejected") throw outcome.error;
      return invocation.invoke();
    } finally {
      endOnce();
    }
  }

  async withSpanAsync<T>(
    name: string,
    fn: (span: Span | null) => Promise<T>,
    startSpan: (name: string) => Span | null,
    endSpan: (span: Span | null, error?: unknown) => void,
  ): Promise<T> {
    let span: Span | null;
    try {
      span = startSpan(name);
    } catch {
      return await fn(null);
    }
    const invocation = createSingleAsyncInvocation(() => fn(span));
    let ended = false;
    const endOnce = (): void => {
      if (ended) return;
      ended = true;
      const outcome = invocation.getOutcome();
      try {
        endSpan(span, outcome.state === "rejected" ? outcome.error : undefined);
      } catch {
        // Telemetry must not affect application behavior.
      }
    };

    try {
      const activeContext = this.api.context.active();
      const spanContext = span ? this.api.trace.setSpan(activeContext, span) : activeContext;
      return await this.api.context.with(spanContext, invocation.invoke);
    } catch {
      const outcome = invocation.getOutcome();
      if (outcome.state === "resolved") return outcome.value;
      if (outcome.state === "rejected") throw outcome.error;
      return await invocation.invoke();
    } finally {
      endOnce();
    }
  }
}

function isSafePropagationHeader(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return SAFE_HEADER_NAME.test(normalized) && !SENSITIVE_HEADERS.has(normalized);
}
