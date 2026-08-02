/**
 * Shared bounds and scalar rules for runtime and static extension metadata
 * validation. Keep this module dependency-free so repository tooling can use
 * the exact production policy without executing extension code.
 *
 * @internal
 */

export const MAX_EXTENSION_CAPABILITIES = 256;
export const MAX_EXTENSION_NAME_CHARACTERS = 256;
export const MAX_EXTENSION_VERSION_CHARACTERS = 128;
export const MAX_CAPABILITY_TYPE_CHARACTERS = 128;
export const MAX_CAPABILITY_NESTING_DEPTH = 32;
export const MAX_CAPABILITY_VALUE_NODES = 8192;
export const MAX_CAPABILITY_CONTAINER_ENTRIES = 4096;
export const MAX_CAPABILITY_KEY_CHARACTERS = 256;
export const MAX_CAPABILITY_STRING_CHARACTERS = 8192;
export const MAX_CAPABILITY_METADATA_UTF8_BYTES = 32_768;
export const MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS = 32_768;
export const MAX_CAPABILITY_AUDIT_UTF8_BYTES = 49_152;
export const MAX_CAPABILITY_AUDIT_UTF16_CODE_UNITS = 49_152;
export const MAX_EXTENSION_CONTRACTS_PER_LIST = 256;
export const MAX_EXTENSION_CONTRACT_NAME_CHARACTERS = 256;
export const MAX_EXTENSION_PRESET_CHILDREN = 256;
export const MAX_EXTENSION_PRESET_DEPTH = 32;
export const MAX_EXTENSION_PRESET_NODES = 4096;

/**
 * Conservative aggregate budget for every Deno permission flag produced for
 * one extension invocation. The paired limits leave headroom for the
 * executable, unrelated arguments, environment, and Windows argument quoting.
 */
export const MAX_DENO_PERMISSION_FLAGS_UTF8_BYTES = 8192;
export const MAX_DENO_PERMISSION_FLAGS_UTF16_CODE_UNITS = 8192;

const metadataTextEncoder = new TextEncoder();

/** Return the UTF-8 byte length used by metadata and command-line budgets. */
export function utf8ByteLength(value: string): number {
  return metadataTextEncoder.encode(value).byteLength;
}

/** Return whether a string contains no unpaired UTF-16 surrogate code units. */
export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Reject characters that can split or visually forge line-oriented audit and
 * command output. Commas are handled separately as Deno flag separators.
 */
export function containsUnicodeControlOrLineSeparator(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit <= 0x1f ||
      (codeUnit >= 0x7f && codeUnit <= 0x9f) ||
      codeUnit === 0x2028 ||
      codeUnit === 0x2029
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Snapshot a bounded dense array through own data descriptors only. This
 * avoids executing iterator, length, index, or accessor hooks in metadata.
 */
export function snapshotDenseMetadataArray(
  value: unknown,
  label: string,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] {
  let isArray: boolean;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    isArray = Array.isArray(value);
    lengthDescriptor = isArray ? Object.getOwnPropertyDescriptor(value, "length") : undefined;
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!isArray || !Number.isSafeInteger(length)) {
    throw new TypeError(
      `${label} must be ${minimumLength > 0 ? "a non-empty array" : "an array"}`,
    );
  }
  if (length < minimumLength) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  if (length > maximumLength) {
    throw new TypeError(`${label} must contain at most ${maximumLength} entries`);
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value as object);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (
    keys.length !== length + 1 || !keys.includes("length") ||
    keys.some((key) =>
      key !== "length" &&
      (typeof key !== "string" || !/^\d+$/.test(key) || Number(key) >= length)
    )
  ) {
    throw new TypeError(`${label} must be a dense array without extra properties`);
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value as object, String(index));
    } catch (cause) {
      throw new TypeError(`${label}[${index}] could not be inspected`, { cause });
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}[${index}] must be an enumerable own data property`);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}
