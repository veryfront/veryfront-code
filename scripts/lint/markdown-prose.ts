/** Read a fence marker in linear time, including long CRLF lines. */
function fenceMarker(line: string) {
  let start = 0;
  while (start < 3 && line[start] === " ") start++;
  const marker = line[start];
  if (marker !== "`" && marker !== "~") return undefined;
  let end = start;
  while (line[end] === marker) end++;
  if (end - start < 3) return undefined;
  return { marker, length: end - start, suffix: line.slice(end) };
}

/** Keep Markdown prose while excluding fenced examples from repository-link checks. */
export function markdownProse(source: string): string {
  let fence: { marker: string; length: number } | undefined;
  return source.split("\n").map((line) => {
    const marker = fenceMarker(line);
    if (fence) {
      if (
        marker?.marker === fence.marker && marker.length >= fence.length &&
        !marker.suffix.trim()
      ) {
        fence = undefined;
      }
      return "";
    }
    if (marker) {
      fence = marker;
      return "";
    }
    return line;
  }).join("\n");
}
