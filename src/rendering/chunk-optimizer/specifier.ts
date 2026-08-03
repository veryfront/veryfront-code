/** Compare a URL-like scheme without normalizing the caller-owned specifier. */
export function hasScheme(value: string, scheme: string): boolean {
  return value.length >= scheme.length &&
    value.slice(0, scheme.length).toLowerCase() === scheme;
}

/** Return a normalized URL-like scheme, excluding the trailing colon. */
export function readScheme(value: string): string | null {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(value);
  return match ? match[0].slice(0, -1).toLowerCase() : null;
}
