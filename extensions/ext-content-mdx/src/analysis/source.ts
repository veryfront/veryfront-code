import type { SourcePoint, SourceRange } from "./types.ts";

export interface SourceLocator {
  readonly point: (offset: number) => SourcePoint;
  readonly range: (start: number, end: number) => SourceRange;
}

export function createSourceLocator(value: string): SourceLocator {
  const lineStarts = [0];
  for (let offset = 0; offset < value.length; offset++) {
    if (value[offset] === "\n") lineStarts.push(offset + 1);
  }

  function point(offset: number): SourcePoint {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const lineStart = lineStarts[middle];
      if (lineStart !== undefined && lineStart <= offset) low = middle;
      else high = middle - 1;
    }
    const lineStart = lineStarts[low] ?? 0;
    return {
      offset,
      line: low + 1,
      column: offset - lineStart + 1,
    };
  }

  return {
    point,
    range: (start, end) => ({ start: point(start), end: point(end) }),
  };
}
