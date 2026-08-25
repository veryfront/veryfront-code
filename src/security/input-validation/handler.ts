import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { createValidationError, VeryfrontError } from "./errors.ts";
import { readBodyBytesWithLimit, resolveRequestLimits, validateRequestLimits } from "./limits.ts";
import { parseJsonBodyAfterRequestLimits, parseQueryParamsAfterRequestLimits } from "./parsers.ts";
import { type RequestLimits, type ValidatedData } from "./types.ts";

const VALIDATED_HANDLER_CONFIG_KEYS = new Set(["body", "query", "limits"]);
const MAX_SCHEMA_PROTOTYPE_DEPTH = 64;

/** Configuration for `createValidatedHandler()`. */
export interface ValidatedHandlerConfig<TBody = unknown, TQuery = unknown> {
  body?: Schema<TBody>;
  query?: Schema<TQuery>;
  limits?: RequestLimits;
}

/** Handler signature that receives validated request data. */
export type ValidatedHandlerFunction<TBody = unknown, TQuery = unknown> = (
  request: Request,
  validated: ValidatedData<TBody, TQuery>,
) => Promise<Response> | Response;

function snapshotOwnConfig(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Validated handler config must be a plain object");
  }

  let prototype: object | null;
  let keys: Array<string | symbol>;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Validated handler config could not be inspected safely");
  }
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError("Validated handler config must be a plain object");
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !VALIDATED_HANDLER_CONFIG_KEYS.has(key)) {
      throw new TypeError(
        `Validated handler config contains an unsupported ${
          typeof key === "string" ? `option: ${key}` : "symbol"
        }`,
      );
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`Validated handler config.${key} could not be inspected safely`);
    }
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`Validated handler config.${key} must be an own data property`);
    }
    snapshot[key] = descriptor.value;
  }

  return Object.freeze(snapshot);
}

function snapshotSchema<T>(value: unknown, label: string): Schema<T> {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    throw new TypeError(`${label} must be a schema object`);
  }

  const receiver = value as object;
  const seen = new Set<object>();
  let current: object | null = receiver;
  let safeParse: Schema<T>["safeParse"] | undefined;

  for (let depth = 0; current !== null; depth++) {
    if (depth >= MAX_SCHEMA_PROTOTYPE_DEPTH || seen.has(current)) {
      throw new TypeError(`${label} has an invalid prototype chain`);
    }
    seen.add(current);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, "safeParse");
    } catch {
      throw new TypeError(`${label}.safeParse could not be inspected safely`);
    }
    if (descriptor) {
      if (!("value" in descriptor)) {
        throw new TypeError(`${label}.safeParse must be a data property`);
      }
      if (typeof descriptor.value !== "function") {
        throw new TypeError(`${label}.safeParse must be a function`);
      }
      safeParse = descriptor.value as Schema<T>["safeParse"];
      break;
    }

    try {
      current = Object.getPrototypeOf(current);
    } catch {
      throw new TypeError(`${label} prototype could not be inspected safely`);
    }
  }

  if (!safeParse) {
    throw new TypeError(`${label}.safeParse must be a function`);
  }

  // The original object remains the method receiver for class-based schema
  // implementations. An immutable own method prevents later property
  // replacement from changing validation after an awaited body read.
  const snapshot = Object.create(receiver) as Schema<T>;
  Object.defineProperty(snapshot, "safeParse", {
    configurable: false,
    enumerable: true,
    value: (data: unknown) => Reflect.apply(safeParse, receiver, [data]),
    writable: false,
  });
  return Object.freeze(snapshot);
}

/**
 * Resolve the underlying `Request` a validated handler must read.
 *
 * The App Router invokes handlers with a real `Request`, but the Pages Router
 * invokes them with the `APIContext` it builds (see `routing/api/route-executor.ts`),
 * whose `.body` is a reader *function* rather than a `ReadableStream`. Reading
 * that context as if it were a `Request` threw
 * `request.body?.getReader is not a function` before validation could run, so
 * no POST body could ever be validated (issue #3666). Accept either shape and
 * hand the real `Request` to the body/limit machinery and to the handler.
 */
/**
 * Unwrap the live `Request` from whatever a router handed the handler.
 *
 * The app router passes a real `Request`; the pages executor passes its
 * `APIContext`, which exposes the request as `.request` / `.req` and whose
 * `body` is a reader *function*. A handler that assumes a `Request` therefore
 * sails past `if (!request.body)` — a function is truthy — and throws on
 * `request.body.getReader()`.
 *
 * @internal shared with the upload handlers, which take the same shape.
 */
export function resolveValidatedRequest(candidate: Request): Request {
  if (candidate instanceof Request) return candidate;

  if (typeof candidate === "object" && candidate !== null) {
    // The Pages Router context exposes the live request as both `.request` and
    // `.req`. Read them defensively — a stray getter must not derail the
    // resolution — and accept the first that is a genuine `Request`.
    for (const key of ["request", "req"] as const) {
      let value: unknown;
      try {
        value = (candidate as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      if (value instanceof Request) return value;
    }
  }

  throw new TypeError(
    "Validated handler expected a Request or an API context exposing one",
  );
}

function cancelUnconsumedBody(request: Request, reason: unknown): void {
  const body = request.body;
  if (!body || body.locked) return;
  try {
    void body.cancel(reason).catch(() => undefined);
  } catch {
    // The validation failure remains authoritative if cancellation fails.
  }
}

async function validateUnparsedBody(
  request: Request,
  maxBodySize: number,
): Promise<void> {
  if (request.body === null) return;
  if (request.bodyUsed) {
    throw createValidationError("Request body has already been consumed");
  }

  let probe: Request;
  try {
    probe = request.clone();
  } catch {
    throw createValidationError("Request body could not be inspected safely");
  }

  try {
    await readBodyBytesWithLimit(probe, maxBodySize);
  } catch (error) {
    cancelUnconsumedBody(request, error);
    throw error;
  }
}

/**
 * Create a validated API handler with bounded body/query validation.
 * Bodies without a schema are preflighted through a clone, leaving the
 * original request body available to the handler after its size is verified.
 */
export function createValidatedHandler<TBody = unknown, TQuery = unknown>(
  config: ValidatedHandlerConfig<TBody, TQuery>,
  handler: ValidatedHandlerFunction<TBody, TQuery>,
): (request: Request) => Promise<Response> {
  const configSnapshot = snapshotOwnConfig(config);
  const bodySchema = configSnapshot.body === undefined
    ? undefined
    : snapshotSchema<TBody>(configSnapshot.body, "Validated handler body schema");
  const querySchema = configSnapshot.query === undefined
    ? undefined
    : snapshotSchema<TQuery>(configSnapshot.query, "Validated handler query schema");
  const limits = resolveRequestLimits(configSnapshot.limits as RequestLimits | undefined);
  if (typeof handler !== "function") {
    throw new TypeError("Validated handler must be a function");
  }
  const handlerSnapshot = handler;

  return async function validatedHandler(requestOrContext: Request): Promise<Response> {
    const request = resolveValidatedRequest(requestOrContext);
    try {
      validateRequestLimits(request, limits);

      const validated: ValidatedData<TBody, TQuery> = {};

      if (bodySchema) {
        validated.body = await parseJsonBodyAfterRequestLimits(
          request,
          bodySchema,
          limits,
        );
      } else {
        await validateUnparsedBody(request, limits.maxBodySize);
      }

      if (querySchema) {
        validated.query = parseQueryParamsAfterRequestLimits(request, querySchema);
      }

      return await handlerSnapshot(request, validated);
    } catch (error) {
      if (!(error instanceof VeryfrontError && error.slug === "input-validation-failed")) {
        throw error;
      }

      const details = (error.context as { details?: unknown } | undefined)?.details;
      return new Response(
        JSON.stringify({ error: error.message, details }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}
