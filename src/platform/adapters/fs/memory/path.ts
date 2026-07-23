import { INVALID_ARGUMENT, SECURITY_VIOLATION } from "#veryfront/errors/error-registry/general.ts";

const MAX_MEMORY_FS_PATH_LENGTH = 4_096;
const ENCODED_PATH_CONTROL = /%(?:00|25|2e|2f|5c)/i;

function unsafePath(): never {
  throw SECURITY_VIOLATION.create({
    detail: "The memory filesystem path is unsafe",
  });
}

function invalidPath(): never {
  throw INVALID_ARGUMENT.create({
    detail: "The memory filesystem path must be a string of at most 4096 characters",
  });
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function canonicalize(path: string): string {
  if (path.length > MAX_MEMORY_FS_PATH_LENGTH) invalidPath();
  if (hasControlCharacters(path) || ENCODED_PATH_CONTROL.test(path)) unsafePath();

  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) unsafePath();
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

/** Normalize a path into the adapter's project-rooted virtual namespace. */
export function normalizeMemoryFSPath(path: unknown, projectDir?: string): string {
  if (typeof path !== "string") invalidPath();
  const normalized = canonicalize(path);
  if (!projectDir) return normalized;

  const normalizedProjectDir = canonicalize(projectDir);
  if (normalized === normalizedProjectDir) return "/";
  if (normalized.startsWith(`${normalizedProjectDir}/`)) {
    return normalized.slice(normalizedProjectDir.length);
  }
  return normalized;
}
