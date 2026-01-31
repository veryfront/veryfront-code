/** Normalize a chunk path for manifest processing */
export function normalizeChunkPath(
  value: string | null | undefined,
  base: string,
): string | null {
  if (!value) return null;

  if (/^https?:\/\//.test(value)) return null;

  const candidate = value.replace(/^\.\//, "");

  if (candidate.startsWith("/")) return candidate;
  if (candidate.startsWith("_veryfront/")) return `/${candidate}`;
  if (candidate.startsWith("chunks/")) return `/_veryfront/${candidate}`;

  return `${base}/${candidate}`;
}
