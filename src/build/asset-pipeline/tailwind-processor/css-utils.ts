export function countUtilities(css: string): number {
  const matches = css.match(/\.[a-zA-Z0-9_-]+/g);
  if (!matches) return 0;
  return new Set(matches).size;
}
