/** Flatten tsconfig `paths` (arrays of candidates) to the first candidate. */
export function flattenTsconfigPaths(
  raw: Record<string, unknown>,
): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") paths[key] = first;
  }
  return paths;
}

/** Resolve an exact or longest-prefix wildcard entry from tsconfig `paths`. */
export function resolveTsconfigPath(
  paths: Readonly<Record<string, string>>,
  specifier: string,
): string | null {
  const exact = paths[specifier];
  if (exact) return exact;

  let best: { prefix: string; suffix: string; target: string } | null = null;
  for (const [key, target] of Object.entries(paths)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    if (best === null || prefix.length > best.prefix.length) {
      best = { prefix, suffix, target };
    }
  }
  if (best === null) return null;

  const matched = specifier.slice(
    best.prefix.length,
    specifier.length - best.suffix.length,
  );
  return best.target.replaceAll("*", matched);
}
