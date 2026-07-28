import { fnv1aHash } from "#veryfront/utils/hash-utils.ts";

export const MAX_IMPORT_WARNING_ENTRIES = 10_000;
const MAX_WARNING_IDENTITY_CHARACTERS = 512;
const WARNING_IDENTITY_PREFIX_CHARACTERS = 128;

function boundWarningIdentity(value: string): string {
  if (value.length <= MAX_WARNING_IDENTITY_CHARACTERS) return value;
  return `${value.slice(0, WARNING_IDENTITY_PREFIX_CHARACTERS)}#${
    fnv1aHash(value)
  }:${value.length}`;
}

/** Build a bounded, length-delimited identity for warning deduplication. */
export function buildImportWarningKey(
  specifier: string,
  projectId?: string,
): string {
  const project = boundWarningIdentity(projectId ?? "");
  const imported = boundWarningIdentity(specifier);
  return `${project.length}:${project}${imported.length}:${imported}`;
}

/** Return true exactly when this warning should be emitted. */
export function rememberImportWarning(
  warned: Set<string>,
  key: string,
): boolean {
  if (warned.has(key)) return false;
  if (warned.size >= MAX_IMPORT_WARNING_ENTRIES) warned.clear();
  warned.add(key);
  return true;
}
