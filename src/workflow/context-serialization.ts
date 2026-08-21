import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { agentLogger } from "#veryfront/utils";
import type { WorkflowContext } from "./types.ts";

const logger = agentLogger.component("workflow-context");

/** How many paths a diagnostic names before it stops enumerating. */
const MAX_REPORTED_PATHS = 5;

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

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return "BigInt";
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : `number (${value})`;
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  return tag === "Object" ? (value?.constructor?.name ?? "object") : tag;
}

/** Whether a value is a plain `{}` object rather than a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null) return false;
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Collect every value under `root` that JSON cannot carry unchanged.
 *
 * Traverses the same ground `JSON.stringify` covers, so the report describes
 * what would actually happen to the value rather than what its type suggests.
 */
function findUnrepresentableValues(root: unknown, label: string): UnrepresentableValue[] {
  const found: UnrepresentableValue[] = [];
  const ancestors = new Set<object>();

  const visit = (value: unknown, path: string): void => {
    if (value === null) return;

    const type = typeof value;
    if (type === "string" || type === "boolean") return;
    if (type === "number") {
      // NaN and the infinities serialize as null, losing the value.
      if (!Number.isFinite(value)) found.push({ path, kind: describe(value), fatal: false });
      return;
    }
    if (type === "bigint") {
      found.push({ path, kind: "BigInt", fatal: true });
      return;
    }
    // Dropped outright: an object key disappears, an array slot becomes null.
    if (type === "undefined" || type === "function" || type === "symbol") {
      found.push({ path, kind: describe(value), fatal: false });
      return;
    }

    const nested = value as Record<string, unknown>;
    if (ancestors.has(nested)) {
      found.push({ path, kind: "circular reference", fatal: true });
      return;
    }

    // A value carrying toJSON is replaced by whatever it returns -- a Date
    // becomes a string, so the type a later step reads is not the type the
    // step that produced it wrote.
    if (typeof nested.toJSON === "function") {
      found.push({ path, kind: describe(nested), fatal: false });
      return;
    }

    if (Array.isArray(nested)) {
      ancestors.add(nested);
      nested.forEach((element, index) => visit(element, `${path}[${index}]`));
      ancestors.delete(nested);
      return;
    }

    // Anything that is not a plain object loses whatever its prototype carried:
    // a Map and a Set both serialize as `{}`, a class instance as its own
    // enumerable fields only. Recording that is not the end of the walk --
    // JSON still encodes those enumerable fields, so a BigInt or a cycle
    // inside one is every bit as fatal as it would be in a plain object.
    if (!isPlainObject(nested)) {
      found.push({ path, kind: describe(nested), fatal: false });
    }

    ancestors.add(nested);
    for (const [key, child] of Object.entries(nested)) {
      visit(child, path ? `${path}.${key}` : key);
    }
    ancestors.delete(nested);
  };

  visit(root, label);
  return found;
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
 * Every field carrying step-authored values goes through this, not just
 * `context`: the same value reaches `nodeStates`, `output`, and checkpoints,
 * and whichever field is encoded first is the one that decides whether the
 * error is a path-aware one or the native message.
 */
export function serializeWorkflowJson(value: unknown, label: string, runId?: string): string {
  const unrepresentable = findUnrepresentableValues(value, label);

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

  return JSON.stringify(value);
}

/** Serialize a workflow context for durable storage. */
export function serializeWorkflowContext(context: WorkflowContext, runId?: string): string {
  return serializeWorkflowJson(context, "context", runId);
}
