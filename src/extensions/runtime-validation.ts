/**
 * Internal runtime validation for dynamically loaded extension boundaries.
 *
 * Static TypeScript contracts disappear at runtime. These helpers validate the
 * small set of values that cross dynamic module and registry boundaries while
 * containing hostile accessors behind contextual TypeErrors.
 */

export type ZeroArgumentConstructor<T> = new () => T;

/** Require a non-empty string without hidden surrounding whitespace. */
export function assertCanonicalNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new TypeError(`${label} must be a non-empty canonical string`);
  }
}

function isConstructor<T>(
  value: unknown,
): value is ZeroArgumentConstructor<T> {
  if (typeof value !== "function") return false;
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
}

/** Read and validate a zero-argument constructor from a dynamic module. */
export function getConstructibleModuleExport<T>(
  extensionModule: unknown,
  moduleName: string,
  exportName: string,
): ZeroArgumentConstructor<T> {
  if (
    extensionModule === null ||
    (typeof extensionModule !== "object" && typeof extensionModule !== "function")
  ) {
    throw new TypeError(
      `Invalid ${moduleName} module: expected a module namespace`,
    );
  }

  let candidate: unknown;
  try {
    candidate = (extensionModule as Record<string, unknown>)[exportName];
  } catch (cause) {
    throw new TypeError(
      `Invalid ${moduleName} module: could not read export "${exportName}"`,
      { cause },
    );
  }

  if (!isConstructor<T>(candidate)) {
    throw new TypeError(
      `Invalid ${moduleName} module: export "${exportName}" must be constructible`,
    );
  }
  return candidate;
}

/** Validate the required method surface of a dynamically constructed value. */
export function assertRequiredMethods(
  instance: unknown,
  moduleName: string,
  exportName: string,
  methodNames: readonly string[],
): void {
  for (const methodName of methodNames) {
    let method: unknown;
    try {
      method = (instance as Record<string, unknown>)[methodName];
    } catch (cause) {
      throw new TypeError(
        `Invalid ${moduleName} module: "${exportName}" instance could not expose method "${methodName}"`,
        { cause },
      );
    }
    if (typeof method !== "function") {
      throw new TypeError(
        `Invalid ${moduleName} module: "${exportName}" instance must implement method "${methodName}"`,
      );
    }
  }
}

function assertRegistrationObject(
  value: unknown,
  registrationName: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `Invalid ${registrationName} registration: expected an object`,
    );
  }
}

function readRegistrationProperty(
  value: unknown,
  registrationName: string,
  propertyName: string,
): unknown {
  assertRegistrationObject(value, registrationName);
  try {
    return value[propertyName];
  } catch (cause) {
    throw new TypeError(
      `Invalid ${registrationName} registration: could not read "${propertyName}"`,
      { cause },
    );
  }
}

/** Capture a registry entry's identity exactly once. */
export function captureRegistrationId(
  value: unknown,
  registrationName: string,
): string {
  const id = readRegistrationProperty(value, registrationName, "id");
  assertCanonicalNonEmptyString(
    id,
    `Invalid ${registrationName} registration: "id"`,
  );
  return id;
}

/** Require a callable method on a registry entry. */
export function assertRegistrationMethod(
  value: unknown,
  registrationName: string,
  methodName: string,
): void {
  const method = readRegistrationProperty(
    value,
    registrationName,
    methodName,
  );
  if (typeof method !== "function") {
    throw new TypeError(
      `Invalid ${registrationName} registration: must implement method "${methodName}"`,
    );
  }
}

/** Validate an optional method when a registry entry supplies it. */
export function assertOptionalRegistrationMethod(
  value: unknown,
  registrationName: string,
  methodName: string,
): void {
  const method = readRegistrationProperty(
    value,
    registrationName,
    methodName,
  );
  if (method !== undefined && typeof method !== "function") {
    throw new TypeError(
      `Invalid ${registrationName} registration: optional method "${methodName}" must be a function when provided`,
    );
  }
}
