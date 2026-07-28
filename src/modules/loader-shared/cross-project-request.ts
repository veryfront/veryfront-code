import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";

const CROSS_PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const CROSS_PROJECT_VERSION_PATTERN = /^[\d^~x][\d.x^~-]{0,127}$/;

export interface NormalizeModulePathOptions {
  /** Decode each URL/specifier segment exactly once before validation. */
  percentEncoded?: boolean;
  subject?: string;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Canonicalize one project-relative module path without allowing segment
 * boundaries to be smuggled through percent encoding.
 */
export function normalizeModulePath(
  path: string,
  options: NormalizeModulePathOptions = {},
): string {
  const subject = options.subject ?? "Module path";
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH_CHARS
  ) {
    throw new RangeError(
      `${subject} must contain 1 to ${MAX_PATH_LENGTH_CHARS} characters`,
    );
  }
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    containsControlCharacter(path)
  ) {
    throw new TypeError(`${subject} must be a plain project-relative path`);
  }

  const rawSegments = path.split("/");
  if (rawSegments.some((segment) => segment.length === 0)) {
    throw new TypeError(`${subject} must not contain empty segments`);
  }

  const segments = rawSegments.map((segment) => {
    let decoded = segment;
    try {
      if (options.percentEncoded) {
        decoded = decodeURIComponent(segment);
      } else {
        // Reject lone surrogate code units that cannot form a stable URL or
        // filesystem identity.
        encodeURIComponent(segment);
      }
    } catch {
      throw new TypeError(`${subject} contains malformed text encoding`);
    }

    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("?") ||
      decoded.includes("#") ||
      containsControlCharacter(decoded)
    ) {
      throw new TypeError(`${subject} contains an unsafe segment`);
    }
    return decoded;
  });

  const normalized = segments.join("/");
  if (normalized.length > MAX_PATH_LENGTH_CHARS) {
    throw new RangeError(`${subject} exceeds ${MAX_PATH_LENGTH_CHARS} decoded characters`);
  }
  return normalized;
}

export function normalizeCrossProjectModulePath(
  path: string,
  options: Pick<NormalizeModulePathOptions, "percentEncoded"> = {},
): string {
  return normalizeModulePath(path, {
    ...options,
    subject: "Cross-project module path",
  });
}

export function assertCrossProjectReference(
  projectSlug: string,
  version: string,
): void {
  if (
    typeof projectSlug !== "string" ||
    !CROSS_PROJECT_SLUG_PATTERN.test(projectSlug)
  ) {
    throw new TypeError("Cross-project project slug is invalid");
  }
  if (
    typeof version !== "string" ||
    (
      version !== "latest" &&
      !CROSS_PROJECT_VERSION_PATTERN.test(version)
    )
  ) {
    throw new TypeError("Cross-project project version is invalid");
  }
}

export function normalizeCrossProjectRegistryBaseUrl(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("Cross-project registry base URL must be an absolute URL");
  }
  const resolved = value.trim();
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    throw new TypeError("Cross-project registry base URL must be an absolute URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Cross-project registry base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new TypeError("Cross-project registry base URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new TypeError("Cross-project registry base URL must not contain a query or fragment");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api")) pathname = pathname.slice(0, -4);
  return `${url.origin}${pathname}`;
}

export function buildCrossProjectRegistryUrl(options: {
  registryBaseUrl: string;
  projectSlug: string;
  version: string;
  modulePath: string;
  includeLatestVersion?: boolean;
}): string {
  assertCrossProjectReference(options.projectSlug, options.version);
  const registryBaseUrl = normalizeCrossProjectRegistryBaseUrl(options.registryBaseUrl);
  const modulePath = normalizeCrossProjectModulePath(options.modulePath);
  const includeVersion = options.version !== "latest" || options.includeLatestVersion === true;
  const projectRef = includeVersion
    ? `${encodeURIComponent(options.projectSlug)}@${encodeURIComponent(options.version)}`
    : encodeURIComponent(options.projectSlug);
  const encodedPath = modulePath.split("/").map(encodeURIComponent).join("/");
  return `${registryBaseUrl}/${projectRef}/@/${encodedPath}`;
}
