import { isBun as IS_BUN } from "#veryfront/platform/compat/runtime.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;

type DataMethodLookup =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "method"; readonly method: (...args: never[]) => unknown };

/**
 * Resolve a data-property method without invoking accessors or ordinary
 * property lookup traps. Class methods live on prototypes, so restricting this
 * lookup to own properties would miss the production FSAdapterWrapper.
 */
function findDataMethod(value: unknown, key: PropertyKey): DataMethodLookup {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return { kind: "absent" };
  }

  let owner: object | null = value as object;
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === Object.prototype) return { kind: "absent" };

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = apply(getOwnPropertyDescriptor, undefined, [
        owner,
        key,
      ]) as PropertyDescriptor | undefined;
    } catch {
      return { kind: "invalid" };
    }

    if (descriptor !== undefined) {
      if (
        !apply(objectPrototypeHasOwnProperty, descriptor, ["value"]) ||
        typeof descriptor.value !== "function"
      ) {
        return { kind: "invalid" };
      }
      return {
        kind: "method",
        method: descriptor.value as (...args: never[]) => unknown,
      };
    }

    try {
      owner = apply(getPrototypeOf, undefined, [owner]) as object | null;
    } catch {
      return { kind: "invalid" };
    }
  }

  return owner === null ? { kind: "absent" } : { kind: "invalid" };
}

/**
 * Read an own data property without invoking project-owned accessors. Missing,
 * inherited, accessor-backed, revoked, and throwing-descriptor values are
 * treated as absent. JavaScript cannot distinguish a transparent Proxy from
 * its target, so a non-throwing Proxy is governed by the descriptor it reports.
 */
export function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  try {
    const descriptor = apply(getOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    if (
      !descriptor ||
      !apply(objectPrototypeHasOwnProperty, descriptor, ["value"])
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

/**
 * Local-project privileges require an explicit own boolean data property.
 * Every ambiguous runtime value fails closed.
 */
export function isExplicitlyLocalProject(value: unknown): boolean {
  return readOwnDataProperty(value, "isLocalProject") === true;
}

/**
 * Host-realm project-code execution requires an explicit runtime capability.
 *
 * An explicitly local development project retains the historical capability.
 * Standalone production runtimes can grant the narrower capability without
 * enabling development-only rendering, caching, diagnostics, or HTTP policy.
 * Every ambiguous value fails closed.
 */
export function isHostProjectCodeExecutionAllowed(value: unknown): boolean {
  return isExplicitlyLocalProject(value) ||
    isExplicitHostProjectCodeExecutionAllowed(value);
}

/**
 * Read only the narrow host-execution capability. Callers that already
 * snapshotted local-development status can use this without inspecting the
 * same boundary property twice.
 */
export function isExplicitHostProjectCodeExecutionAllowed(
  value: unknown,
): boolean {
  return !IS_BUN && readOwnDataProperty(value, "allowHostProjectCodeExecution") === true;
}

/**
 * Decide whether a surface must refuse to execute tenant project code.
 *
 * Execution is denied only when the runtime is shared *and* its host-owned
 * entrypoint did not grant the host-execution capability. Local development,
 * dedicated single-project runtimes, and operator-granted shared executors all
 * carry the capability. Every ambiguous value fails closed.
 *
 * Every execution surface shares this single predicate so their boundaries
 * cannot drift apart.
 */
export function requiresIsolatedProjectRuntime(value: unknown): boolean {
  return !isHostProjectCodeExecutionAllowed(value) && isSharedProjectRuntime(value);
}

/**
 * Identify a shared multi-project/proxy runtime from host-owned context.
 *
 * This is deliberately independent from `isLocalProject`: a dedicated
 * single-project runtime may use production source while still being allowed
 * to execute that one project's code. Shared runtimes are identified by their
 * hosted-config preparation boundary or an adapter that explicitly reports
 * multi-project mode.
 */
export function isSharedProjectRuntime(value: unknown): boolean {
  if (readOwnDataProperty(value, "prepareHostedConfigContext") !== undefined) {
    return true;
  }

  const adapter = readOwnDataProperty(value, "adapter");
  const fs = readOwnDataProperty(adapter, "fs");
  const lookup = findDataMethod(fs, "isMultiProjectMode");
  if (lookup.kind === "absent") return false;
  if (lookup.kind === "invalid") return true;

  try {
    const result = apply(lookup.method, fs, []);
    return result === false ? false : true;
  } catch {
    // An ambiguous or broken topology signal must never unlock shared host
    // execution. Callers can still fail closed through their locality guard.
    return true;
  }
}
