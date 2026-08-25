const MAX_RETURN_PATH_CODE_UNITS = 2_048;
const MAX_PERCENT_DECODE_PASSES = 8;
const RETURN_PATH_ORIGIN = "https://veryfront.local";
const AUTH_ROUTE_PATH = "/_veryfront/auth";

export function parseApplicationAuthReturnPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Application auth return path must be a string");
  }
  if (value.length === 0 || value.length > MAX_RETURN_PATH_CODE_UNITS) {
    throw new TypeError("Application auth return path is outside the size limit");
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new TypeError("Application auth return path must start with exactly one slash");
  }
  if (value.includes("#")) {
    throw new TypeError("Application auth return path must not contain a fragment");
  }
  rejectUnsafeDecodedReturnPath(value);

  let resolved: URL;
  try {
    resolved = new URL(value, RETURN_PATH_ORIGIN);
  } catch (error) {
    throw new TypeError("Application auth return path is not a valid URL path", { cause: error });
  }
  if (resolved.origin !== RETURN_PATH_ORIGIN) {
    throw new TypeError("Application auth return path must remain same-origin");
  }
  if (resolved.hash !== "") {
    throw new TypeError("Application auth return path must not contain a fragment");
  }

  const canonical = `${resolved.pathname}${resolved.search}`;
  rejectUnsafeDecodedReturnPath(canonical);
  rejectAuthRoute(canonical);
  return canonical;
}

function rejectUnsafeDecodedReturnPath(value: string): void {
  decodeRepeatedly(value, (decoded) => {
    rejectNonRelativeDecodedPath(decoded);
    rejectRawControlOrBackslash(decoded);
  });
}

function decodeRepeatedly(value: string, inspect: (decoded: string) => void): string {
  let decoded = value;
  for (let iteration = 0; iteration < MAX_PERCENT_DECODE_PASSES; iteration += 1) {
    inspect(decoded);
    const next = decodeOnePass(decoded);
    if (next === decoded) return decoded;
    decoded = next;
  }

  inspect(decoded);
  if (decodeOnePass(decoded) !== decoded) {
    throw new TypeError("Application auth return path exceeds the percent-decode limit");
  }
  return decoded;
}

function decodeOnePass(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new TypeError("Application auth return path contains invalid percent encoding", {
      cause: error,
    });
  }
}

function rejectNonRelativeDecodedPath(value: string): void {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new TypeError("Application auth return path must stay app-relative after decoding");
  }
}

function rejectRawControlOrBackslash(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) {
      throw new TypeError("Application auth return path contains a control character or backslash");
    }
  }
}

function rejectAuthRoute(value: string): void {
  const path = new URL(value, RETURN_PATH_ORIGIN).pathname;
  decodeRepeatedly(path, (decodedPath) => {
    const normalized = new URL(decodedPath, RETURN_PATH_ORIGIN).pathname;
    if (normalized === AUTH_ROUTE_PATH || normalized.startsWith(`${AUTH_ROUTE_PATH}/`)) {
      throw new TypeError("Application auth return path must not target the auth route");
    }
  });
}
