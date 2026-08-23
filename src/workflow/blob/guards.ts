import type { BlobRef } from "./types.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { isSafeBlobId } from "./blob-id.ts";

const dateGetTime = Date.prototype.getTime;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const missing = Symbol("missing blob ref field");
const invalid = Symbol("invalid blob ref field");

function ownDataValue(
  value: unknown,
  key: keyof BlobRef,
): unknown | typeof missing | typeof invalid {
  if (typeof value !== "object" || value === null) return invalid;
  const descriptor = objectGetOwnPropertyDescriptor(value, key);
  if (!descriptor) return missing;
  return "value" in descriptor ? descriptor.value : invalid;
}

function isValidDate(value: unknown): value is Date {
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) return false;
  try {
    return numberIsFinite(reflectApply(dateGetTime, value, []));
  } catch {
    return false;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) return false;
  try {
    const prototype = objectGetPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return false;
    const descriptors = objectGetOwnPropertyDescriptors(value);
    const keys = reflectOwnKeys(descriptors);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key];
      if (
        !descriptor || !descriptor.enumerable || !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Type guard verifying that an unknown value is a BlobRef.
 *
 * Checks structural shape rather than relying on `__kind` alone, so
 * user data that happens to contain `{ __kind: "blob" }` does not
 * incorrectly route through the blob resolver.
 */
export function isBlobRef(value: unknown): value is BlobRef {
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) return false;
  try {
    const kind = ownDataValue(value, "__kind");
    const id = ownDataValue(value, "id");
    const size = ownDataValue(value, "size");
    const mimeType = ownDataValue(value, "mimeType");
    const createdAt = ownDataValue(value, "createdAt");
    const expiresAt = ownDataValue(value, "expiresAt");
    const url = ownDataValue(value, "url");
    const metadata = ownDataValue(value, "metadata");

    return kind === "blob" && isSafeBlobId(id) &&
      typeof size === "number" && numberIsSafeInteger(size) && size >= 0 &&
      typeof mimeType === "string" && mimeType.length > 0 &&
      isValidDate(createdAt) &&
      (expiresAt === missing || expiresAt === undefined || isValidDate(expiresAt)) &&
      (url === missing || url === undefined || typeof url === "string") &&
      (metadata === missing || metadata === undefined || isStringRecord(metadata));
  } catch {
    return false;
  }
}
