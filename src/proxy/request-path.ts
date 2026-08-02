/**
 * Canonicalize an origin-form request path. URL resolution APIs interpret a
 * leading `//` as an authority, so proxy boundaries retain exactly one leading
 * slash before using the path in redirects or upstream targets.
 */
export function normalizeProxyOriginFormPath(pathname: string): string {
  if (typeof pathname !== "string" || pathname.length === 0 || pathname[0] !== "/") {
    throw new TypeError("Proxy request pathname must use origin form");
  }

  let firstPathCharacter = 1;
  while (pathname.charCodeAt(firstPathCharacter) === 0x2f) {
    firstPathCharacter++;
  }
  return firstPathCharacter === 1 ? pathname : `/${pathname.slice(firstPathCharacter)}`;
}
