import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { agentLogger } from "#veryfront/utils";
import type { WorkflowContext } from "./types.ts";

const logger = agentLogger.component("workflow-context");

/** How many paths a diagnostic names before it stops enumerating. */
const MAX_REPORTED_PATHS = 5;

/**
 * How deep the walk descends before handing the value back to `JSON.stringify`.
 *
 * This walk recurses and `JSON.stringify` does not, so a value nested a few
 * thousand levels deep exhausts the stack here while JSON encodes it without
 * complaint. Failing such a run with `Maximum call stack size exceeded` raised
 * from inside the backend is the outcome this module exists to remove, so past
 * this depth the diagnostic is dropped rather than the run: the value is
 * encoded the way the backend encoded it before this check existed.
 */
const MAX_TRAVERSAL_DEPTH = 1000;

/** Ends a walk that ran past `MAX_TRAVERSAL_DEPTH`. Never leaves this module. */
const TRAVERSAL_TOO_DEEP = new Error("workflow value nested deeper than the walk follows");

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

/** A value the durable codec cannot carry, named by where it sits. */
interface UnrepresentableValue {
  readonly path: string;
  readonly kind: string;
}

/**
 * What one walk found, split by how JSON fails the value.
 *
 * JSON fails a value in two ways: it refuses to encode it at all -- a BigInt, a
 * cycle -- or it encodes something lesser, like a Date becoming a string or a
 * Map becoming `{}`. The first fails the run, the second changes what a later
 * step reads, so they warrant different responses.
 *
 * Each side keeps at most `MAX_REPORTED_PATHS` paths and counts the rest. A
 * step is free to return an array with half a million holes, and every hole is
 * a diagnostic no message will ever show, so holding one entry per hole would
 * spend memory proportional to the payload on the persistence path. The counts
 * stay exact, so a message still says how many there were.
 */
interface UnrepresentableValues {
  readonly fatal: UnrepresentableValue[];
  readonly lossy: UnrepresentableValue[];
  fatalCount: number;
  lossyCount: number;
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

/**
 * Whether a value could hold a primitive slot, judging only unspoofed tags.
 *
 * `Object.prototype.toString` reports the same internal slots the probes below
 * read, and reports them without throwing. It stops being trustworthy only when
 * the value carries a `Symbol.toStringTag`, which anything can set, so a value
 * that has one is sent to the probes instead of being judged here.
 */
function couldHoldPrimitiveSlot(value: JsonTraversalReference): boolean {
  try {
    if (Symbol.toStringTag in value) return true;
    const tag = Object.prototype.toString.call(value);
    return tag === "[object Number]" || tag === "[object String]" ||
      tag === "[object Boolean]" || tag === "[object BigInt]";
  } catch {
    // Hostile metadata cannot answer this; let the probes decide.
    return true;
  }
}

/** The kind of primitive slot a boxed value carries. */
type BoxedPrimitiveSlot = "number" | "string" | "boolean" | "bigint";

/**
 * Which primitive slot a value carries, read without consulting metadata.
 *
 * Each probe throws on a miss, so reaching all four costs four thrown
 * exceptions, and a context is mostly made of objects that miss every one.
 * `couldHoldPrimitiveSlot` rejects those without throwing, which is what keeps
 * this off the cost of every object a run persists.
 */
function boxedPrimitiveSlot(value: JsonTraversalReference): BoxedPrimitiveSlot | null {
  if (!couldHoldPrimitiveSlot(value)) return null;
  try {
    Number.prototype.valueOf.call(value);
    return "number";
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    String.prototype.valueOf.call(value);
    return "string";
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    Boolean.prototype.valueOf.call(value);
    return "boolean";
  } catch {
    // Try the next boxed primitive brand.
  }
  try {
    BigInt.prototype.valueOf.call(value);
    return "bigint";
  } catch {
    return null;
  }
}

/**
 * Convert a boxed primitive the way JSON converts it.
 *
 * JSON puts a Number box through `ToNumber` and a String box through
 * `ToString`, and both of those ask the object, so a replaced `valueOf` or a
 * replaced prototype decides what JSON writes. `Number` and `String` perform
 * those same two conversions. Reading the slot instead would persist a value
 * JSON never wrote, which is the one outcome this module has to avoid. A
 * Boolean box is the case JSON does read straight from the slot.
 */
function unboxAsJsonWould(
  value: JsonTraversalReference,
  slot: BoxedPrimitiveSlot,
): string | number | boolean | bigint {
  if (slot === "number") return Number(value);
  if (slot === "string") return String(value);
  if (slot === "boolean") return Boolean.prototype.valueOf.call(value);
  // JSON refuses a BigInt box outright, and the walk reports it by its path.
  return BigInt.prototype.valueOf.call(value);
}

/** Build the exact value JSON will encode, collecting what it cannot carry. */
function normalizeAndFindUnrepresentableValues(
  root: unknown,
  label: string,
): {
  normalized: unknown;
  unrepresentable: UnrepresentableValues;
} {
  const found: UnrepresentableValues = { fatal: [], lossy: [], fatalCount: 0, lossyCount: 0 };
  const active = new Set<JsonTraversalReference>();

  const recordFatal = (path: string, kind: string) => {
    found.fatalCount++;
    if (found.fatal.length < MAX_REPORTED_PATHS) found.fatal.push({ path, kind });
  };

  // `index` is appended here rather than by the caller, so an array with more
  // holes than a message can show never builds the paths it would drop.
  const recordLossy = (path: string, kind: string, index?: number) => {
    found.lossyCount++;
    if (found.lossy.length >= MAX_REPORTED_PATHS) return;
    found.lossy.push({ path: index === undefined ? path : `${path}[${index}]`, kind });
  };

  const normalize = (
    value: unknown,
    path: string,
    key: string,
    applyToJson: boolean,
    depth: number,
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
        recordLossy(path, describeToJsonValue(value));
        return normalize(replacement, path, key, false, depth);
      }
    }

    if (type === "string" || type === "boolean") return value as string | boolean;
    if (type === "number") {
      if (!Number.isFinite(value)) {
        recordLossy(path, describe(value));
        return null;
      }
      return value as number;
    }
    if (type === "bigint") {
      recordFatal(path, "BigInt");
      return null;
    }
    if (type === "undefined" || type === "function" || type === "symbol") {
      recordLossy(path, describe(value));
      return OMIT_JSON_VALUE;
    }

    const nested = value as JsonTraversalReference;
    if (active.has(nested)) {
      recordFatal(path, "circular reference");
      return null;
    }

    const isArray = Array.isArray(nested);
    if (!isArray) {
      const slot = boxedPrimitiveSlot(nested);
      if (slot !== null) {
        recordLossy(path, "boxed primitive");
        return normalize(unboxAsJsonWould(nested, slot), path, key, false, depth);
      }
    }

    if (depth >= MAX_TRAVERSAL_DEPTH) throw TRAVERSAL_TOO_DEEP;
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
          if (isHole) recordLossy(path, "array hole", index);
          if (isHole && child === undefined) {
            result.push(null);
            continue;
          }
          const normalized = normalize(
            child,
            `${path}[${index}]`,
            indexKey,
            true,
            depth + 1,
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
          depth + 1,
        );
        if (normalized !== OMIT_JSON_VALUE) result[childKey] = normalized;
      }
      // Prototype diagnostics are best-effort and run after the snapshot is
      // complete, so hostile metadata traps cannot change persistence output.
      if (!isPlainObject(nested)) recordLossy(path, describe(nested));
      return result;
    } finally {
      active.delete(nested);
    }
  };

  let normalized: NormalizedJsonValue | typeof OMIT_JSON_VALUE;
  try {
    normalized = normalize(root, label, "", true, 0);
  } catch (error) {
    if (error !== TRAVERSAL_TOO_DEEP) throw error;
    // Nested past what this walk follows. What it found on the way down still
    // holds, and the rest is left to `JSON.stringify`, which is iterative and
    // reaches a depth this walk cannot.
    return { normalized: root, unrepresentable: found };
  }

  return {
    normalized: normalized === OMIT_JSON_VALUE ? undefined : normalized,
    unrepresentable: found,
  };
}

function formatPaths(samples: readonly UnrepresentableValue[], total: number): string {
  const shown = samples.map(({ path, kind }) => `${path} (${kind})`).join(", ");
  const remaining = total - samples.length;
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
 * this check decides the diagnostic rather than the anonymous error a later
 * field would raise on the same value.
 *
 * Scope, stated plainly because the ordering above is easy to read as more:
 * only `context` is checked. A run's `input`, `output`, `nodeStates`,
 * `currentNodes`, and `error` are encoded directly, so nothing here inspects
 * them. That is deliberate for now: `nodeStates` carries a `Date` on every
 * node, so checking it would report the framework's own timestamps on every
 * run. Anything the framework writes into `context` has to obey the same rule
 * it asks of a step, which is why the loop encodes its child node states
 * rather than being exempted from the check.
 */
/** @internal Prepare the exact JSON value and encoded string for durable storage. */
export function prepareWorkflowJson(
  value: unknown,
  label: string,
  runId?: string,
): { normalized: unknown; serialized: string } {
  const { normalized, unrepresentable } = normalizeAndFindUnrepresentableValues(value, label);
  const { fatal, fatalCount, lossy, lossyCount } = unrepresentable;

  if (fatalCount > 0) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run cannot be persisted: ${formatPaths(fatal, fatalCount)}. Workflow ` +
        `state must be JSON-representable, because a run that suspends is stored as JSON. ` +
        `Return a plain object from the step that produced this value.`,
    });
  }

  if (lossyCount > 0) {
    logger.warn(
      "Workflow state holds values that do not survive persistence unchanged",
      {
        ...(runId ? { runId } : {}),
        paths: formatPaths(lossy, lossyCount),
      },
    );
  }

  // Encoded only once the fatal check has passed, so a value JSON refuses is
  // named by this module rather than by the anonymous error JSON raises.
  return { normalized, serialized: JSON.stringify(normalized) };
}

export function serializeWorkflowJson(value: unknown, label: string, runId?: string): string {
  return prepareWorkflowJson(value, label, runId).serialized;
}

/** Serialize a workflow context for durable storage. */
export function serializeWorkflowContext(context: WorkflowContext, runId?: string): string {
  return serializeWorkflowJson(context, "context", runId);
}
