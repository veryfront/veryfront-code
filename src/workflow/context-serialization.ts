import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { agentLogger } from "#veryfront/utils";
import type { WorkflowContext } from "./types.ts";

const logger = agentLogger.component("workflow-context");

/** How many paths a diagnostic names before it stops enumerating. */
const MAX_REPORTED_PATHS = 5;

/**
 * Property names safe to quote verbatim in a diagnostic.
 *
 * A path is built from the keys a step chose, and a step is free to key an
 * object by an email address, an account id, or any other payload value. The
 * diagnostic is flattened into a single string before it reaches the logger,
 * where key-based redaction can no longer see the structure -- so an
 * unrecognised key would travel into logs and persisted error details as
 * ordinary message text.
 *
 * Field names written by a developer are plain identifiers, which is what this
 * admits. Anything else is replaced: the path still says how deep the value is
 * and what shape it sits in, without repeating the data.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/;

function redactPathSegment(key: string): string {
  return SAFE_PATH_SEGMENT.test(key) ? key : "<redacted>";
}

/**
 * A value the durable codec cannot carry.
 *
 * `fatal` separates the two ways JSON fails a value: it either refuses to
 * encode it at all -- a BigInt, a cycle -- or encodes something lesser, like a
 * Date becoming a string or a Map becoming `{}`. The first fails the run, the
 * second changes what a later step reads, so they warrant different responses.
 */
interface UnrepresentableValue {
  readonly path: string;
  readonly kind: string;
  readonly fatal: boolean;
}

/** Object identity tracked while JSON.stringify walks the active value graph. */
type JsonTraversalReference = object;

interface NormalizedJsonObject {
  [key: string]: NormalizedJsonValue;
}

interface RawJsonValue {
  readonly rawJSON: string;
}

interface JsonRawSupport {
  isRawJSON?(value: unknown): value is RawJsonValue;
}

const jsonRawSupport = JSON as typeof JSON & JsonRawSupport;

type NormalizedJsonValue =
  | null
  | boolean
  | number
  | string
  | NormalizedJsonValue[]
  | NormalizedJsonObject
  | RawJsonValue;

const OMIT_JSON_VALUE = Symbol("omit-json-value");

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return "BigInt";
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : `number (${value})`;
  return "object";
}

/** Whether a value is a plain `{}` object rather than a class instance. */
function isPlainObject(value: JsonTraversalReference): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function describeToJsonValue(value: unknown): string {
  if (typeof value === "bigint") return "BigInt";
  if (typeof value === "object") {
    try {
      Date.prototype.getTime.call(value);
      return "Date";
    } catch {
      // The value is not a Date.
    }
  }
  return "toJSON value";
}

function toJsonLength(value: unknown): number {
  // Unary plus uses the specification's ToNumber operation, which rejects a
  // BigInt directly or returned by an object's primitive conversion.
  const number = +(value as number);
  if (Number.isNaN(number) || number <= 0) return 0;
  if (number === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
  return Math.min(Math.floor(number), Number.MAX_SAFE_INTEGER);
}

interface BoxedJsonPrimitive {
  readonly value: string | number | boolean | bigint;
}

/** Probe internal primitive slots without consulting spoofable metadata. */
function unboxJsonPrimitive(value: JsonTraversalReference): BoxedJsonPrimitive | null {
  try {
    return { value: Number.prototype.valueOf.call(value) };
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    return { value: String.prototype.valueOf.call(value) };
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    return { value: Boolean.prototype.valueOf.call(value) };
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    return { value: BigInt.prototype.valueOf.call(value) };
  } catch {
    return null;
  }
}

/** Serialize once while collecting every value JSON cannot carry unchanged. */
function serializeAndFindUnrepresentableValues(
  root: unknown,
  label: string,
): {
  normalized: NormalizedJsonValue | undefined;
  serialized: string;
  unrepresentable: UnrepresentableValue[];
} {
  const found: UnrepresentableValue[] = [];
  const active = new Set<JsonTraversalReference>();

  const normalize = (
    value: unknown,
    path: string,
    key: string,
    applyToJson: boolean,
  ): NormalizedJsonValue | typeof OMIT_JSON_VALUE => {
    if (value === null) return null;

    const type = typeof value;
    if (
      type === "object" &&
      typeof jsonRawSupport.isRawJSON === "function" &&
      jsonRawSupport.isRawJSON(value)
    ) {
      return value as RawJsonValue;
    }
    if (
      applyToJson &&
      (type === "object" || type === "function" || type === "bigint")
    ) {
      const receiver = type === "bigint" ? Object(value) : value as JsonTraversalReference;
      const toJson = Reflect.get(receiver, "toJSON");
      if (typeof toJson === "function") {
        const replacement = Reflect.apply(toJson, value, [key]);
        found.push({ path, kind: describeToJsonValue(value), fatal: false });
        return normalize(replacement, path, key, false);
      }
    }

    if (type === "string" || type === "boolean") return value as string | boolean;
    if (type === "number") {
      if (!Number.isFinite(value)) {
        found.push({ path, kind: describe(value), fatal: false });
        return null;
      }
      return value as number;
    }
    if (type === "bigint") {
      found.push({ path, kind: "BigInt", fatal: true });
      return null;
    }
    if (type === "undefined" || type === "function" || type === "symbol") {
      found.push({ path, kind: describe(value), fatal: false });
      return OMIT_JSON_VALUE;
    }

    const nested = value as JsonTraversalReference;
    if (active.has(nested)) {
      found.push({ path, kind: "circular reference", fatal: true });
      return null;
    }

    const isArray = Array.isArray(nested);
    if (!isArray) {
      const boxed = unboxJsonPrimitive(nested);
      if (boxed) {
        found.push({ path, kind: "boxed primitive", fatal: false });
        return normalize(boxed.value, path, key, false);
      }
    }

    active.add(nested);
    try {
      if (isArray) {
        const result: NormalizedJsonValue[] = [];
        const length = toJsonLength(Reflect.get(nested, "length"));
        for (let index = 0; index < length; index++) {
          const indexKey = String(index);
          const child = Reflect.get(nested, indexKey);
          let isHole = false;
          try {
            isHole = !Object.hasOwn(nested, indexKey);
          } catch {
            // Hole diagnostics are best-effort; the captured value still wins.
          }
          if (isHole) {
            found.push({ path: `${path}[${index}]`, kind: "array hole", fatal: false });
          }
          if (isHole && child === undefined) {
            result.push(null);
            continue;
          }
          const normalized = normalize(
            child,
            `${path}[${index}]`,
            indexKey,
            true,
          );
          result.push(normalized === OMIT_JSON_VALUE ? null : normalized);
        }
        return result;
      }

      const result: NormalizedJsonObject = Object.create(null);
      for (const childKey of Object.keys(nested)) {
        const normalized = normalize(
          Reflect.get(nested, childKey),
          `${path}.${redactPathSegment(childKey)}`,
          childKey,
          true,
        );
        if (normalized !== OMIT_JSON_VALUE) result[childKey] = normalized;
      }
      // Prototype diagnostics are best-effort and run after the snapshot is
      // complete, so hostile metadata traps cannot change persistence output.
      if (!isPlainObject(nested)) {
        found.push({ path, kind: describe(nested), fatal: false });
      }
      return result;
    } finally {
      active.delete(nested);
    }
  };

  const normalized = normalize(root, label, "", true);
  const normalizedValue = normalized === OMIT_JSON_VALUE ? undefined : normalized;
  const serialized = JSON.stringify(normalizedValue);

  return { normalized: normalizedValue, serialized, unrepresentable: found };
}

function formatPaths(values: readonly UnrepresentableValue[]): string {
  const shown = values.slice(0, MAX_REPORTED_PATHS)
    .map(({ path, kind }) => `${path} (${kind})`)
    .join(", ");
  const remaining = values.length - MAX_REPORTED_PATHS;
  return remaining > 0 ? `${shown}, and ${remaining} more` : shown;
}

/**
 * Serialize one field of a workflow run for durable storage.
 *
 * `WorkflowContext` is JSON-representable by contract, but nothing enforced it:
 * a step writes whatever it returns, and the in-memory backend keeps the value
 * intact, so a run that never suspends never notices. Persisting the same run
 * puts it through `JSON.stringify`, which quietly rewrites some values and
 * refuses others.
 *
 * Checking here makes the mismatch legible at the moment it matters:
 *
 * - Values JSON cannot encode at all fail the run with the field and path that
 *   produced them, instead of `Do not know how to serialize a BigInt` raised
 *   from inside the backend with nothing pointing back at the step.
 * - Values it encodes lossily are logged with the same detail, because the
 *   alternative is a step reading a `string` where its predecessor wrote a
 *   `Date`, decided by whether the run happened to pause.
 *
 * Durable backends serialize context before its duplicate run projections, so
 * this check decides the diagnostic without treating framework-owned metadata
 * such as node timestamps as user-authored lossy values.
 */
/** @internal Prepare the exact JSON value and encoded string for durable storage. */
export function prepareWorkflowJson(
  value: unknown,
  label: string,
  runId?: string,
): { normalized: unknown; serialized: string } {
  const { normalized, serialized, unrepresentable } = serializeAndFindUnrepresentableValues(
    value,
    label,
  );

  const fatal = unrepresentable.filter((entry) => entry.fatal);
  if (fatal.length > 0) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run cannot be persisted: ${formatPaths(fatal)}. Workflow state must be ` +
        `JSON-representable, because a run that suspends is stored as JSON. Return a plain ` +
        `object from the step that produced this value.`,
    });
  }

  const lossy = unrepresentable.filter((entry) => !entry.fatal);
  if (lossy.length > 0) {
    logger.warn(
      "Workflow state holds values that do not survive persistence unchanged",
      {
        ...(runId ? { runId } : {}),
        paths: formatPaths(lossy),
      },
    );
  }

  return { normalized, serialized };
}

export function serializeWorkflowJson(value: unknown, label: string, runId?: string): string {
  return prepareWorkflowJson(value, label, runId).serialized;
}

/** Serialize a workflow context for durable storage. */
export function serializeWorkflowContext(context: WorkflowContext, runId?: string): string {
  return serializeWorkflowJson(context, "context", runId);
}
