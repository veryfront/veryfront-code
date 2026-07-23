const MAX_PROJECT_SLUG_LENGTH = 128;
const PROJECT_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Normalize and validate a project slug used by local project routing. */
export function canonicalizeLocalProjectSlug(slug: string): string | undefined {
  const canonicalSlug = slug.normalize("NFKC").trim();
  if (
    canonicalSlug.length === 0 || canonicalSlug.length > MAX_PROJECT_SLUG_LENGTH ||
    !PROJECT_SLUG_PATTERN.test(canonicalSlug)
  ) {
    return undefined;
  }
  return canonicalSlug;
}
