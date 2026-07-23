import {
  isSensitiveKey,
  REDACTED,
  sanitizeUrlCredentials,
} from "#veryfront/utils/logger/redact.ts";

export type TelemetryAttributeValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[]
  | undefined;

const SEMANTIC_TOKEN_COUNT_ATTRIBUTE =
  /(?:^|[._-])(?:input|output|total|prompt|completion)[._-]?tokens?$/i;

function isNumericSemanticTokenCount(key: string, value: TelemetryAttributeValue): boolean {
  return typeof value === "number" && Number.isFinite(value) &&
    SEMANTIC_TOKEN_COUNT_ATTRIBUTE.test(key);
}

/** Redact a single flattened telemetry attribute. */
export function sanitizeTelemetryAttributeValue(
  key: string,
  value: TelemetryAttributeValue,
): TelemetryAttributeValue {
  if (isSensitiveKey(key) && !isNumericSemanticTokenCount(key, value)) return REDACTED;
  if (typeof value === "string") return sanitizeUrlCredentials(value);
  if (Array.isArray(value)) {
    try {
      return value.map((item) => typeof item === "string" ? sanitizeUrlCredentials(item) : item);
    } catch (_) {
      return REDACTED;
    }
  }
  return value;
}

/** Return a redacted copy of a flattened telemetry attribute record. */
export function sanitizeTelemetryAttributes<
  T extends Record<string, TelemetryAttributeValue> | undefined,
>(attributes: T): T {
  if (!attributes) return attributes;

  let keys: string[];
  try {
    keys = Object.keys(attributes);
  } catch (_) {
    return {} as T;
  }

  const sanitized: Record<string, TelemetryAttributeValue> = {};
  for (const key of keys) {
    let value: TelemetryAttributeValue = REDACTED;
    if (!isSensitiveKey(key) || SEMANTIC_TOKEN_COUNT_ATTRIBUTE.test(key)) {
      try {
        value = sanitizeTelemetryAttributeValue(key, attributes[key]);
      } catch (_) {
        value = REDACTED;
      }
    }
    Object.defineProperty(sanitized, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return sanitized as T;
}

const MAX_STRUCTURED_DATA_DEPTH = 32;

function cloneDate(value: Date): Date | typeof REDACTED {
  try {
    return new Date(value.getTime());
  } catch (_) {
    return REDACTED;
  }
}

function cloneUrl(value: URL): URL | string {
  try {
    return new URL(sanitizeUrlCredentials(value.href));
  } catch (_) {
    return REDACTED;
  }
}

function sanitizeStructuredValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
): unknown {
  if (typeof value === "string") return sanitizeUrlCredentials(value);
  if (
    value === null || value === undefined || typeof value === "number" ||
    typeof value === "boolean" || typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "symbol" || typeof value === "function") return REDACTED;
  if (depth >= MAX_STRUCTURED_DATA_DEPTH || seen.has(value)) return REDACTED;

  if (value instanceof Date) return cloneDate(value);
  if (value instanceof URL) return cloneUrl(value);

  seen.add(value);
  try {
    if (value instanceof Error) {
      let name = "Error";
      let message = REDACTED;
      let stack: string | undefined;
      try {
        name = sanitizeUrlCredentials(value.name);
        message = sanitizeUrlCredentials(value.message);
        stack = value.stack ? sanitizeUrlCredentials(value.stack) : undefined;
      } catch (_) {
        /* hostile Error accessors remain redacted */
      }
      return { name, message, stack };
    }

    let toJSON: unknown;
    try {
      toJSON = (value as { toJSON?: unknown }).toJSON;
    } catch (_) {
      return REDACTED;
    }
    if (typeof toJSON === "function") {
      try {
        return sanitizeStructuredValue(
          toJSON.call(value),
          depth + 1,
          seen,
        );
      } catch (_) {
        return REDACTED;
      }
    }

    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        try {
          copy.push(sanitizeStructuredValue(value[index], depth + 1, seen));
        } catch (_) {
          copy.push(REDACTED);
        }
      }
      return copy;
    }

    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch (_) {
      return REDACTED;
    }

    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      let child: unknown = REDACTED;
      if (!isSensitiveKey(key)) {
        try {
          child = sanitizeStructuredValue(
            (value as Record<string, unknown>)[key],
            depth + 1,
            seen,
          );
        } catch (_) {
          child = REDACTED;
        }
      }
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true,
      });
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

/**
 * Return a detached, fail-closed snapshot suitable for retained logs and
 * errors. Credential-like keys and URL credentials are redacted recursively.
 */
export function sanitizeStructuredTelemetryData<T>(value: T): T {
  try {
    return sanitizeStructuredValue(value, 0, new Set<object>()) as T;
  } catch (_) {
    return REDACTED as T;
  }
}

/**
 * Create an error safe to send to telemetry backends without mutating or
 * replacing the application error that will be returned to the caller.
 */
export function sanitizeErrorForTelemetry(error: unknown): Error {
  let isError = false;
  try {
    isError = error instanceof Error;
  } catch (_) {
    /* hostile prototype inspection is treated as an unknown error */
  }

  let message = "Unknown error";
  try {
    message = sanitizeUrlCredentials(isError ? (error as Error).message : String(error));
  } catch (_) {
    /* expected: hostile error accessors are replaced */
  }

  const sanitized = new Error(message);
  if (!isError) {
    sanitized.name = "Unknown";
    return sanitized;
  }

  try {
    const source = error as Error;
    sanitized.name = source.constructor.name || source.name || "Error";
  } catch (_) {
    sanitized.name = "Error";
  }
  try {
    const stack = (error as Error).stack;
    if (stack) sanitized.stack = sanitizeUrlCredentials(stack);
  } catch (_) {
    /* expected: hostile stack accessors are omitted */
  }
  return sanitized;
}
