/** Read an environment variable from Deno, Node.js, or Bun. */
export function getEnv(key: string): string | undefined {
  // Deno
  if (typeof Deno !== "undefined" && Deno.env?.get) {
    return Deno.env.get(key);
  }

  // Node.js / Bun
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
  return nodeProcess?.env?.[key];
}

/** Return whether a string contains C0 or DEL control characters. */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/** Parse a required-range integer setting, using the fallback only when absent. */
export function parseIntegerSetting(
  name: string,
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum ||
    !Number.isSafeInteger(fallback) || fallback < minimum || fallback > maximum
  ) {
    throw new RangeError(`${name} parser bounds and fallback must be valid integers`);
  }
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

/** Validate and normalize an HTTP(S) service base URL. */
export function parseHttpBaseUrl(name: string, raw: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4_096) {
    throw new TypeError(`${name} must be a non-empty URL of at most 4096 characters`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${name} must be a valid absolute HTTP or HTTPS URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${name} must use HTTP or HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${name} must not contain credentials, a query, or a fragment`);
  }
  return url.toString().replace(/\/+$/, "");
}

/** Parse a proxy bind URL and reject path or credential-bearing values. */
export function parseProxyBindingSetting(
  raw: string,
): { hostname: string; port: number } {
  const normalized = parseHttpBaseUrl("VERYFRONT_PROXY_URL", raw);
  const url = new URL(normalized);
  if (url.pathname !== "/") {
    throw new TypeError("VERYFRONT_PROXY_URL must not contain a path");
  }
  const port = url.port
    ? parseIntegerSetting("VERYFRONT_PROXY_URL port", url.port, 0, 1, 65_535)
    : url.protocol === "https:"
    ? 443
    : 80;
  return { hostname: url.hostname, port };
}

/** Parse a bounded JSON map of local project slugs to filesystem paths. */
export function parseLocalProjectsSetting(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.trim() === "") return {};
  if (raw.length > 1_048_576) {
    throw new TypeError("LOCAL_PROJECTS must be at most 1048576 characters");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TypeError("LOCAL_PROJECTS must be a JSON object of project paths");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("LOCAL_PROJECTS must be a JSON object of project paths");
  }
  const entries = Object.entries(value);
  if (entries.length > 10_000) {
    throw new TypeError("LOCAL_PROJECTS can contain at most 10000 projects");
  }
  const projects: Record<string, string> = Object.create(null);
  for (const [slug, path] of entries) {
    if (
      slug.length === 0 || slug.length > 256 || typeof path !== "string" || path.length === 0 ||
      path.length > 4_096 || hasControlCharacter(slug) || hasControlCharacter(path)
    ) {
      throw new TypeError(
        "LOCAL_PROJECTS keys and paths must be non-empty strings within their size limits",
      );
    }
    Object.defineProperty(projects, slug, {
      configurable: false,
      enumerable: true,
      value: path,
      writable: false,
    });
  }
  return Object.freeze(projects);
}
