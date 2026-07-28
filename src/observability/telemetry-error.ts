import {
  isSensitiveKey,
  REDACTED,
  sanitizeUrlCredentials,
} from "#veryfront/utils/logger/redact.ts";
import {
  LOG_PREVIEW_MAX_LENGTH_CHARS,
  MAX_STRING_DISPLAY_LENGTH,
  MAX_TRACE_ATTRIBUTE_VALUE_SIZE,
} from "#veryfront/utils/constants/index.ts";
import {
  MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES,
  MAX_STRUCTURED_TELEMETRY_DEPTH,
  MAX_STRUCTURED_TELEMETRY_NODES,
  MAX_TELEMETRY_ATTRIBUTE_ARRAY_LENGTH,
  MAX_TELEMETRY_ATTRIBUTE_COUNT,
  MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH,
} from "./limits.ts";

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

/** Redact and bound text before retaining it or handing it to a provider. */
export function sanitizeTelemetryText(value: string, maxLength: number): string {
  const sanitized = sanitizeUrlCredentials(value);
  if (sanitized.length <= maxLength) return sanitized;
  return `${sanitized.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** Redact a single flattened telemetry attribute. */
export function sanitizeTelemetryAttributeValue(
  key: string,
  value: TelemetryAttributeValue,
): TelemetryAttributeValue {
  if (isSensitiveKey(key) && !isNumericSemanticTokenCount(key, value)) return REDACTED;
  if (typeof value === "string") {
    return sanitizeTelemetryText(value, MAX_TRACE_ATTRIBUTE_VALUE_SIZE);
  }
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  if (Array.isArray(value)) {
    try {
      if (value.length > MAX_TELEMETRY_ATTRIBUTE_ARRAY_LENGTH) return REDACTED;
      const sanitized: (string | number | boolean)[] = [];
      for (let index = 0; index < value.length; index++) {
        const item = value[index];
        if (typeof item === "number" && !Number.isFinite(item)) return REDACTED;
        sanitized.push(
          typeof item === "string"
            ? sanitizeTelemetryText(item, MAX_TRACE_ATTRIBUTE_VALUE_SIZE)
            : item,
        );
      }
      return sanitized;
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
  const retainedKeys = new Set<string>();
  for (const key of keys.slice(0, MAX_TELEMETRY_ATTRIBUTE_COUNT)) {
    const boundedKey = key.length <= MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH
      ? key
      : key.slice(0, MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH);
    if (!boundedKey || retainedKeys.has(boundedKey)) continue;

    let value: TelemetryAttributeValue = REDACTED;
    if (!isSensitiveKey(key) || SEMANTIC_TOKEN_COUNT_ATTRIBUTE.test(key)) {
      try {
        value = sanitizeTelemetryAttributeValue(key, attributes[key]);
      } catch (_) {
        value = REDACTED;
      }
    }
    if (value === undefined) continue;
    Object.defineProperty(sanitized, boundedKey, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    retainedKeys.add(boundedKey);
  }
  return sanitized as T;
}

interface StructuredTelemetryBudget {
  exhausted: boolean;
  remainingNodes: number;
}

function cloneDate(value: Date): Date | typeof REDACTED {
  try {
    return new Date(value.getTime());
  } catch (_) {
    return REDACTED;
  }
}

function cloneUrl(value: URL): URL | string {
  try {
    const href = sanitizeUrlCredentials(value.href);
    if (href.length > MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH) return REDACTED;
    return new URL(href);
  } catch (_) {
    return REDACTED;
  }
}

function sanitizeStructuredValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
  budget: StructuredTelemetryBudget,
): unknown {
  if (budget.remainingNodes <= 0) {
    budget.exhausted = true;
    return REDACTED;
  }
  budget.remainingNodes--;

  if (typeof value === "string") {
    return sanitizeTelemetryText(value, MAX_STRING_DISPLAY_LENGTH);
  }
  if (
    value === null || value === undefined || typeof value === "number" ||
    typeof value === "boolean" || typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "symbol" || typeof value === "function") return REDACTED;
  if (depth >= MAX_STRUCTURED_TELEMETRY_DEPTH || seen.has(value)) return REDACTED;

  if (value instanceof Date) return cloneDate(value);
  if (value instanceof URL) return cloneUrl(value);

  seen.add(value);
  try {
    if (value instanceof Error) {
      let name = "Error";
      let message = REDACTED;
      let stack: string | undefined;
      try {
        name = sanitizeTelemetryText(value.name, LOG_PREVIEW_MAX_LENGTH_CHARS);
        message = sanitizeTelemetryText(value.message, MAX_STRING_DISPLAY_LENGTH);
        stack = value.stack
          ? sanitizeTelemetryText(value.stack, MAX_STRING_DISPLAY_LENGTH)
          : undefined;
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
          budget,
        );
      } catch (_) {
        return REDACTED;
      }
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES) {
        return REDACTED;
      }
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        try {
          copy.push(sanitizeStructuredValue(value[index], depth + 1, seen, budget));
        } catch (_) {
          copy.push(REDACTED);
        }
        if (budget.exhausted) return REDACTED;
      }
      return copy;
    }

    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch (_) {
      return REDACTED;
    }
    if (keys.length > MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES) {
      return REDACTED;
    }

    const copy: Record<string, unknown> = {};
    const retainedKeys = new Set<string>();
    for (const key of keys) {
      const boundedKey = sanitizeTelemetryText(key, LOG_PREVIEW_MAX_LENGTH_CHARS);
      if (retainedKeys.has(boundedKey)) return REDACTED;
      let child: unknown = REDACTED;
      if (!isSensitiveKey(key)) {
        try {
          child = sanitizeStructuredValue(
            (value as Record<string, unknown>)[key],
            depth + 1,
            seen,
            budget,
          );
        } catch (_) {
          child = REDACTED;
        }
      }
      if (budget.exhausted) return REDACTED;
      Object.defineProperty(copy, boundedKey, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true,
      });
      retainedKeys.add(boundedKey);
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
    return sanitizeStructuredValue(
      value,
      0,
      new Set<object>(),
      {
        exhausted: false,
        remainingNodes: MAX_STRUCTURED_TELEMETRY_NODES,
      },
    ) as T;
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
    message = sanitizeTelemetryText(
      isError ? (error as Error).message : String(error),
      MAX_STRING_DISPLAY_LENGTH,
    );
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
    sanitized.name = sanitizeTelemetryText(
      source.constructor.name || source.name || "Error",
      LOG_PREVIEW_MAX_LENGTH_CHARS,
    );
  } catch (_) {
    sanitized.name = "Error";
  }
  try {
    const stack = (error as Error).stack;
    if (stack) {
      sanitized.stack = sanitizeTelemetryText(stack, MAX_STRING_DISPLAY_LENGTH);
    }
  } catch (_) {
    /* expected: hostile stack accessors are omitted */
  }
  return sanitized;
}
