import {
  canInspectErrorStackDescriptorWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import {
  isVeryfrontErrorInstance,
  snapshotKnownVeryfrontErrorData,
  type VeryfrontError,
  type VeryfrontErrorSnapshot,
} from "./error-core.ts";

export {
  defineError,
  type ErrorCategory,
  type ErrorCreateOptions,
  type ErrorDefinition,
  isVeryfrontErrorInstance,
  type RegisteredError,
  type RFC9457Response,
  VeryfrontError,
  type VeryfrontErrorOptions,
  type VeryfrontErrorSnapshot,
} from "./error-core.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

/**
 * Read a VeryfrontError once into plain data.
 *
 * A proxy can pass `instanceof VeryfrontError` and still throw from any field
 * getter. Boundary code must use this snapshot instead of repeatedly reading
 * the original object.
 */
export function snapshotVeryfrontError(error: unknown): VeryfrontErrorSnapshot | null {
  if (!isVeryfrontErrorInstance(error)) return null;
  return snapshotKnownVeryfrontError(error);
}

/**
 * Snapshot a value that has already been classified as a VeryfrontError.
 *
 * Keeping classification separate lets boundary code avoid a second
 * `instanceof`/proxy-prototype inspection after it has committed to this
 * branch.
 */
export function snapshotKnownVeryfrontError(
  error: VeryfrontError,
): VeryfrontErrorSnapshot | null {
  try {
    const snapshot = snapshotKnownVeryfrontErrorData(error);
    if (!snapshot) return null;

    let stack: unknown;
    if (canInspectErrorStackDescriptorWithoutHooks) {
      const descriptor = getOwnPropertyDescriptor(error, "stack");
      stack = descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
    }
    if (stack !== undefined && typeof stack !== "string") return null;

    return {
      ...snapshot,
      stack: stack as string | undefined,
    };
  } catch {
    return null;
  }
}
