import { SECURITY_VIOLATION } from "#veryfront/errors/error-registry/general.ts";

const ENCODED_PATH_CONTROL = /%(?:00|25|2e|2f|5c)/i;

function unsafePath(): never {
  throw SECURITY_VIOLATION.create({
    detail: "Filesystem request contains an unsafe project source path",
  });
}

function hasControlCharacters(path: string): boolean {
  return Array.from(path).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function normalizeSeparators(path: string): string {
  if (hasControlCharacters(path) || ENCODED_PATH_CONTROL.test(path)) unsafePath();
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function normalizeSegments(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) unsafePath();
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/** Normalize the configured local project root without discarding absoluteness. */
export function normalizeGitHubProjectDir(projectDir: string): string {
  const normalized = normalizeSeparators(projectDir);
  const isAbsolute = normalized.startsWith("/");
  const canonical = normalizeSegments(normalized);
  return isAbsolute && canonical ? `/${canonical}` : canonical;
}

export function normalizeGitHubPath(path: string, projectDir: string = ""): string {
  let normalized = normalizeSeparators(path);
  const normalizedProjectDir = normalizeGitHubProjectDir(projectDir);

  if (
    normalizedProjectDir &&
    (normalized === normalizedProjectDir || normalized.startsWith(`${normalizedProjectDir}/`))
  ) {
    normalized = normalized.slice(normalizedProjectDir.length);
  }

  return normalizeSegments(normalized);
}
