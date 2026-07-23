import { SECURITY_VIOLATION } from "#veryfront/errors/error-registry/general.ts";

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:\//;
const ENCODED_PATH_CONTROL = /%(?:00|25|2e|2f|5c)/i;

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function normalizeProjectRoot(projectDir: string): string {
  const normalized = normalizeSeparators(projectDir);
  if (normalized === "/" || WINDOWS_ABSOLUTE_PATH.test(normalized) && normalized.length === 3) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(path);
}

function isWithinRoot(path: string, root: string): boolean {
  const caseInsensitive = WINDOWS_ABSOLUTE_PATH.test(path) && WINDOWS_ABSOLUTE_PATH.test(root);
  const candidate = caseInsensitive ? path.toLowerCase() : path;
  const expectedRoot = caseInsensitive ? root.toLowerCase() : root;
  return candidate === expectedRoot || candidate.startsWith(
    expectedRoot.endsWith("/") ? expectedRoot : `${expectedRoot}/`,
  );
}

function assertSafeSourcePath(path: string): void {
  if (
    path.includes("\0") ||
    /(^|\/)\.\.(\/|$)/.test(path) ||
    ENCODED_PATH_CONTROL.test(path)
  ) {
    throw SECURITY_VIOLATION.create({
      detail: "Filesystem request contains an unsafe project source path",
    });
  }
}

export class PathNormalizer {
  private readonly normalizedProjectDir?: string;

  constructor(private readonly projectDir?: string) {
    if (projectDir?.includes("\0")) {
      throw SECURITY_VIOLATION.create({
        detail: "Configured project directory contains an unsafe path",
      });
    }
    this.normalizedProjectDir = projectDir === undefined
      ? undefined
      : normalizeProjectRoot(projectDir);
  }

  getProjectDir(): string | undefined {
    return this.projectDir;
  }

  normalize(path: string): string {
    let normalized = normalizeSeparators(path);
    assertSafeSourcePath(normalized);

    if (this.normalizedProjectDir && isAbsolutePath(normalized)) {
      if (!isWithinRoot(normalized, this.normalizedProjectDir)) {
        throw SECURITY_VIOLATION.create({
          detail: "Filesystem path resolves outside the configured project directory",
        });
      }
      normalized = normalized.slice(this.normalizedProjectDir.length);
    } else if (WINDOWS_ABSOLUTE_PATH.test(normalized)) {
      throw SECURITY_VIOLATION.create({
        detail: "An absolute filesystem path requires a configured project directory",
      });
    }

    normalized = normalized.replace(/^\/+|\/+$/g, "");
    if (normalized.startsWith("@/")) normalized = normalized.slice(2);

    return normalized.split("/").filter((segment) => segment !== "." && segment !== "").join("/");
  }
}
