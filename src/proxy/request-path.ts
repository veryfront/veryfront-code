const IntrinsicReflectApply = Reflect.apply;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeSlice = String.prototype.slice;

function stringCharCodeAt(value: string, index: number): number {
  return IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function stringSlice(value: string, start: number): string {
  return IntrinsicReflectApply(StringPrototypeSlice, value, [start]) as string;
}

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
  while (stringCharCodeAt(pathname, firstPathCharacter) === 0x2f) {
    firstPathCharacter++;
  }
  return firstPathCharacter === 1 ? pathname : `/${stringSlice(pathname, firstPathCharacter)}`;
}
