import { CONFIG_PARSE_ERROR } from "#veryfront/errors/error-registry/config.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import type { LockfileData, LockfileEntry } from "./types.ts";

export const LOCKFILE_VERSION = 1;
export const MAX_LOCKFILE_BYTES = 10 * 1024 * 1024;
export const MAX_LOCKFILE_CONTENT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_COUNT = 10_000;
const MAX_URL_LENGTH = 8192;
const MAX_DEPENDENCIES_PER_ENTRY = 128;
export const MAX_TOTAL_DEPENDENCIES = 100_000;
const INTEGRITY_PATTERN = /^sha256-[a-f0-9]{64}$/;
const ALLOWED_LOCKFILE_KEYS = new Set(["version", "imports"]);
const ALLOWED_ENTRY_KEYS = new Set(["resolved", "integrity", "dependencies", "fetchedAt"]);
const UTF8_ENCODER = new TextEncoder();

export function createEmptyLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: {} };
}

interface ValidatedLockfile {
  data: LockfileData;
  contentBytes: number;
  dependencyCount: number;
  importCount: number;
}

class LockfileValidationFailure extends Error {}

function validationFailure(): never {
  throw new LockfileValidationFailure();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

export function validateRemoteUrl(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > MAX_URL_LENGTH ||
    value !== value.trim() || hasAsciiControlCharacter(value)
  ) {
    return validationFailure();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return validationFailure();
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return validationFailure();
  }
  return value;
}

function validateDependency(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > MAX_URL_LENGTH ||
    hasAsciiControlCharacter(value)
  ) {
    return validationFailure();
  }
  return value;
}

function validateFetchedAt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 64) return validationFailure();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return validationFailure();
  }
  return value;
}

export function validateEntry(value: unknown): LockfileEntry {
  if (!isRecord(value) || !hasOnlyKeys(value, ALLOWED_ENTRY_KEYS)) {
    return validationFailure();
  }

  const resolved = validateRemoteUrl(value.resolved);
  if (typeof value.integrity !== "string" || !INTEGRITY_PATTERN.test(value.integrity)) {
    return validationFailure();
  }

  let dependencies: string[] | undefined;
  if (value.dependencies !== undefined) {
    if (
      !Array.isArray(value.dependencies) ||
      value.dependencies.length > MAX_DEPENDENCIES_PER_ENTRY
    ) {
      return validationFailure();
    }
    dependencies = value.dependencies.map(validateDependency);
  }

  const fetchedAt = validateFetchedAt(value.fetchedAt);
  return {
    resolved,
    integrity: value.integrity,
    ...(dependencies ? { dependencies } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
  };
}

export function entryContentBytes(entry: LockfileEntry): number {
  return utf8ByteLength(entry.resolved) + utf8ByteLength(entry.integrity) +
    (entry.fetchedAt ? utf8ByteLength(entry.fetchedAt) : 0) +
    (entry.dependencies?.reduce((sum, dependency) => sum + utf8ByteLength(dependency), 0) ?? 0);
}

function validateLockfile(value: unknown): ValidatedLockfile {
  if (!isRecord(value) || !hasOnlyKeys(value, ALLOWED_LOCKFILE_KEYS)) {
    return validationFailure();
  }
  if (value.version !== LOCKFILE_VERSION || !isRecord(value.imports)) {
    return validationFailure();
  }

  const importEntries = Object.entries(value.imports);
  if (importEntries.length > MAX_IMPORT_COUNT) return validationFailure();

  const imports = Object.create(null) as Record<string, LockfileEntry>;
  let contentBytes = 0;
  let dependencyCount = 0;
  for (const [urlCandidate, entryCandidate] of importEntries) {
    const url = validateRemoteUrl(urlCandidate);
    const entry = validateEntry(entryCandidate);
    contentBytes += utf8ByteLength(url) + entryContentBytes(entry);
    dependencyCount += entry.dependencies?.length ?? 0;
    if (
      contentBytes > MAX_LOCKFILE_CONTENT_BYTES ||
      dependencyCount > MAX_TOTAL_DEPENDENCIES
    ) {
      return validationFailure();
    }
    imports[url] = entry;
  }

  return {
    data: { version: LOCKFILE_VERSION, imports },
    contentBytes,
    dependencyCount,
    importCount: importEntries.length,
  };
}

export function invalidArgument(message: string): Error {
  return INVALID_ARGUMENT.create({ message, detail: message });
}

export function parseLockfile(content: string): ValidatedLockfile {
  try {
    if (UTF8_ENCODER.encode(content).byteLength > MAX_LOCKFILE_BYTES) {
      return validationFailure();
    }
    return validateLockfile(JSON.parse(content));
  } catch {
    throw CONFIG_PARSE_ERROR.create({
      message: "The import lockfile is invalid",
      detail: "The import lockfile must use the supported version and schema",
    });
  }
}

export function snapshotLockfileArgument(data: LockfileData): ValidatedLockfile {
  try {
    return validateLockfile(data);
  } catch {
    throw invalidArgument("Lockfile data must use the supported version and schema");
  }
}

export function snapshotUrlArgument(url: string): string {
  try {
    return validateRemoteUrl(url);
  } catch {
    throw invalidArgument("The import URL must be a safe HTTP or HTTPS URL");
  }
}

export function snapshotEntryArgument(entry: LockfileEntry): LockfileEntry {
  try {
    return validateEntry(entry);
  } catch {
    throw invalidArgument("The lockfile entry is invalid");
  }
}

export function cloneEntry(entry: LockfileEntry): LockfileEntry {
  return {
    resolved: entry.resolved,
    integrity: entry.integrity,
    ...(entry.dependencies ? { dependencies: [...entry.dependencies] } : {}),
    ...(entry.fetchedAt ? { fetchedAt: entry.fetchedAt } : {}),
  };
}

export function cloneLockfile(data: LockfileData): LockfileData {
  const imports = Object.create(null) as Record<string, LockfileEntry>;
  for (const [url, entry] of Object.entries(data.imports)) imports[url] = cloneEntry(entry);
  return { version: LOCKFILE_VERSION, imports };
}

export function createInternalEmptyLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: Object.create(null) };
}
