/** Callback used by trigger-family validators to create their domain error. */
export type ContractInvalidator = (detail: string) => never;

function inspect<T>(operation: () => T, detail: string, invalid: ContractInvalidator): T {
  try {
    return operation();
  } catch {
    return invalid(detail);
  }
}

function safeFieldName(key: PropertyKey): string | undefined {
  return typeof key === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(key) && key.length <= 80
    ? key
    : undefined;
}

/** Snapshot one exact plain-object contract without executing property accessors. */
export function snapshotExactRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
  invalid: ContractInvalidator,
): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    invalid(`${label} must be an object.`);
  }
  const isArray = inspect(
    () => Array.isArray(value),
    `${label} must be a plain object with data properties.`,
    invalid,
  );
  if (isArray) invalid(`${label} must be an object.`);

  const prototype = inspect(
    () => Object.getPrototypeOf(value),
    `${label} must be a plain object with data properties.`,
    invalid,
  );
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${label} must be a plain object.`);
  }

  const keys = inspect(
    () => Reflect.ownKeys(value),
    `${label} must be a plain object with data properties.`,
    invalid,
  );
  const allowed = new Set(allowedKeys);
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const fieldName = safeFieldName(key);
    if (!fieldName || !allowed.has(fieldName)) {
      invalid(
        fieldName
          ? `${label}.${fieldName} is not supported.`
          : `${label} contains an unsupported field.`,
      );
    }
    const descriptor = inspect(
      () => Object.getOwnPropertyDescriptor(value, key),
      `${label} must be a plain object with data properties.`,
      invalid,
    );
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(`${label}.${fieldName} must be a data property.`);
    }
    Object.defineProperty(snapshot, fieldName, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return snapshot;
}

/** Snapshot a bounded dense array without executing indexed accessors. */
export function snapshotDenseArray(
  value: unknown,
  label: string,
  maxLength: number,
  invalid: ContractInvalidator,
): unknown[] {
  const isArray = inspect(
    () => Array.isArray(value),
    `${label} must be a dense array without accessors.`,
    invalid,
  );
  if (!isArray) invalid(`${label} must be an array.`);
  const array = value as unknown[];

  const lengthDescriptor = inspect(
    () => Object.getOwnPropertyDescriptor(array, "length"),
    `${label} must be a dense array without accessors.`,
    invalid,
  );
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > maxLength
  ) {
    invalid(`${label} must contain at most ${maxLength} entries.`);
  }

  const keys = inspect(
    () => Reflect.ownKeys(array),
    `${label} must be a dense array without accessors.`,
    invalid,
  );
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
      invalid(`${label} must not contain extra properties.`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      invalid(`${label} must not contain extra properties.`);
    }
  }

  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index++) {
    const descriptor = inspect(
      () => Object.getOwnPropertyDescriptor(array, String(index)),
      `${label} must be a dense array without accessors.`,
      invalid,
    );
    if (!descriptor || !("value" in descriptor)) {
      invalid(`${label} must be a dense array without accessors.`);
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}
