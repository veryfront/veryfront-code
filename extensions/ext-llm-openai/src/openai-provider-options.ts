const ReflectApply = Reflect.apply;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const ArrayIsArray = Array.isArray;

function objectKeys(value: Record<string, unknown>): string[] {
  return ReflectApply(ObjectKeys, Object, [value]) as string[];
}

function defineOwnDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  ReflectApply(ObjectDefineProperty, Object, [target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  }]);
}

function readProviderBucket(
  providerOptions: Record<string, unknown>,
  providerName: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [
      providerOptions,
      providerName,
    ]) as PropertyDescriptor | undefined;
  } catch {
    throw new TypeError(`Provider options for "${providerName}" could not be read`);
  }
  if (!descriptor) return undefined;
  if (!ReflectApply(ObjectHasOwn, Object, [descriptor, "value"])) {
    throw new TypeError(`Provider options for "${providerName}" must be a data property`);
  }
  return descriptor.value;
}

function readProviderOption(
  providerName: string,
  bucket: Record<string, unknown>,
  key: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [bucket, key]) as
      | PropertyDescriptor
      | undefined;
  } catch {
    throw new TypeError(`Provider options for "${providerName}" could not be enumerated`);
  }
  if (!descriptor?.enumerable) return undefined;
  if (!ReflectApply(ObjectHasOwn, Object, [descriptor, "value"])) {
    throw new TypeError(`Provider options for "${providerName}" must contain data properties`);
  }
  return descriptor.value;
}

/**
 * Merge provider-native options without invoking legacy prototype setters such
 * as `Object.prototype.__proto__`.
 */
export function defineOpenAIProviderOptions(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  const keys = objectKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const value = readProviderOption("openai", source, key);
    defineOwnDataProperty(target, key, value);
  }
}

export function readOpenAIProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
  providerNames: readonly string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!providerOptions) return output;

  for (let providerIndex = 0; providerIndex < providerNames.length; providerIndex += 1) {
    const providerName = providerNames[providerIndex]!;
    const bucket = readProviderBucket(providerOptions, providerName);
    if (bucket === null || typeof bucket !== "object" || ArrayIsArray(bucket)) continue;
    let keys: string[];
    try {
      keys = objectKeys(bucket as Record<string, unknown>);
    } catch {
      throw new TypeError(`Provider options for "${providerName}" could not be enumerated`);
    }
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex]!;
      defineOwnDataProperty(
        output,
        key,
        readProviderOption(providerName, bucket as Record<string, unknown>, key),
      );
    }
  }

  return output;
}
