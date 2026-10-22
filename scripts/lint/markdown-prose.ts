/** Keep Markdown prose while excluding fenced examples from repository-link checks. */
export function markdownProse(source: string): string {
  let fence: { marker: string; length: number } | undefined;
  return source.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker && marker[1]?.[0] === fence.marker &&
        marker[1].length >= fence.length && !marker[2]?.trim()
      ) {
        fence = undefined;
      }
      return "";
    }
    if (marker?.[1]) {
      fence = { marker: marker[1][0]!, length: marker[1].length };
      return "";
    }
    return line;
  }).join("\n");
}
