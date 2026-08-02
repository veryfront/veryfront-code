/** Dependency-free validation for extension-owned, immutable browser bundles. */

import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const textEncoder = new TextEncoder();
const arrayIsArray = Array.isArray;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const reflectOwnKeys = Reflect.ownKeys;

export interface ImmutableBrowserBundleValidationOptions {
  readonly bundleLabel: string;
  readonly providerLabel: string;
  readonly maxBytes: number;
}

function assertCanonicalBundleString(
  value: string,
  options: ImmutableBrowserBundleValidationOptions,
): void {
  const { bundleLabel } = options;
  if (value.length === 0 || /^\s*$/u.test(value)) {
    throw new TypeError(`${bundleLabel} must be a non-empty JavaScript string`);
  }
  if (value.charCodeAt(0) === 0xfeff) {
    throw new TypeError(`${bundleLabel} must not start with a BOM`);
  }

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) throw new TypeError(`${bundleLabel} must not contain NUL`);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!Number.isInteger(trailing) || trailing < 0xdc00 || trailing > 0xdfff) {
        throw new TypeError(`${bundleLabel} must contain canonical Unicode`);
      }
      index++;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`${bundleLabel} must contain canonical Unicode`);
    }
  }
}

/** Validate canonical JavaScript source and its exact UTF-8 byte budget. */
export function validateImmutableBrowserBundle(
  value: unknown,
  options: ImmutableBrowserBundleValidationOptions,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${options.bundleLabel} must be a string`);
  }
  if (value.length > options.maxBytes) {
    throw new RangeError(`${options.bundleLabel} exceeds the ${options.maxBytes}-byte limit`);
  }
  assertCanonicalBundleString(value, options);
  if (textEncoder.encode(value).byteLength > options.maxBytes) {
    throw new RangeError(`${options.bundleLabel} exceeds the ${options.maxBytes}-byte limit`);
  }
  return value;
}

/** Snapshot a strict one-property provider without invoking accessors. */
export function snapshotImmutableBrowserBundleProvider(
  value: unknown,
  options: ImmutableBrowserBundleValidationOptions,
): Readonly<{ browserBundle: string }> {
  if (!value || typeof value !== "object" || isProxyWithoutHooks(value)) {
    throw new TypeError(`${options.providerLabel} must be an object`);
  }

  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let isArray: boolean;
  try {
    isArray = arrayIsArray(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${options.providerLabel} could not be inspected`, { cause });
  }
  if (isArray) throw new TypeError(`${options.providerLabel} must be an object`);

  const keys = reflectOwnKeys(descriptors);
  if (keys.length !== 1 || keys[0] !== "browserBundle") {
    throw new TypeError(
      `${options.providerLabel} must contain only the "browserBundle" property`,
    );
  }
  const descriptor = descriptors.browserBundle;
  if (
    !descriptor || !descriptor.enumerable || descriptor.get || descriptor.set ||
    typeof descriptor.value !== "string"
  ) {
    throw new TypeError(
      `${options.providerLabel} browserBundle must be a string data property`,
    );
  }

  return objectFreeze({
    browserBundle: validateImmutableBrowserBundle(descriptor.value, options),
  });
}
