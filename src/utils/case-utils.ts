export function capitalizeSeparatedWords(
  value: string,
  separator: RegExp | string,
  joiner: string,
): string {
  return value
    .split(separator)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(joiner);
}
