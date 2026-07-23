const MAX_PATH_SEGMENT_LENGTH = 4096;

/**
 * Decode every percent-encoding layer in a single path segment.
 *
 * Each successful decoding pass must shorten the value, so the loop is
 * bounded by the input length without relying on an arbitrary pass count.
 */
export function decodePathSegmentFully(segment: string): string {
  if (segment.length > MAX_PATH_SEGMENT_LENGTH) {
    throw new TypeError("Path segment exceeds the size limit");
  }

  let decoded = segment;
  while (true) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new TypeError("Path segment has invalid percent encoding");
    }

    if (next === decoded) return decoded;
    if (next.length >= decoded.length) {
      throw new TypeError("Path segment percent decoding did not make progress");
    }
    decoded = next;
  }
}

export function hasPathControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function isSafeModulePathSegment(segment: string): boolean {
  if (!segment) return false;

  try {
    const decoded = decodePathSegmentFully(segment);
    return decoded !== "." && decoded !== ".." &&
      !/[\\/?#<>"']/.test(decoded) && !hasPathControlCharacter(decoded);
  } catch {
    return false;
  }
}
