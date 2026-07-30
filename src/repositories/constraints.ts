/** Maximum size of one repository identity component before encoding. */
export const MAX_REPOSITORY_IDENTITY_CODE_UNITS = 32 * 1024;

/**
 * Maximum composed repository cache-key size.
 *
 * This matches the strictest general cache backend limit so a key accepted by
 * the repository layer remains portable across memory, disk, API, and extension-backed
 * backends.
 */
export const MAX_REPOSITORY_CACHE_KEY_CODE_UNITS = 64 * 1024;

/** Maximum diagnostic cache name length accepted by the shared cache layer. */
export const MAX_REPOSITORY_CACHE_NAME_CODE_UNITS = 256;

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

/** Return whether a string contains only complete Unicode scalar sequences. */
export function hasWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index++;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

/** Shared runtime/schema invariant for project and content-source identity. */
export function isRepositoryIdentityComponent(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_REPOSITORY_IDENTITY_CODE_UNITS &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    hasWellFormedUnicode(value);
}

/** Shared runtime/schema invariant for human-readable cache names. */
export function isRepositoryCacheName(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_REPOSITORY_CACHE_NAME_CODE_UNITS &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    hasWellFormedUnicode(value);
}
