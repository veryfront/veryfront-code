import * as pathHelper from "#veryfront/compat/path";

// Split `react/jsx-runtime` -> { name: "react", subpath: "./jsx-runtime" } and
// `@scope/pkg/sub/path` -> { name: "@scope/pkg", subpath: "./sub/path" }.
export function splitPackageSubpath(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split("/");
  const segments = specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  const name = segments.join("/");
  const rest = parts.slice(segments.length).join("/");
  return { name, subpath: rest ? `./${rest}` : "." };
}

// Pick the relative file path from a `package.json#exports` entry, which can
// be a string, a conditional object (`{ import, default, ... }`), or an array.
export function pickPackageExportEntry(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) {
    for (const e of entry) {
      const value = pickPackageExportEntry(e);
      if (value) return value;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const candidate = obj.import ?? obj.node ?? obj.default;
    return candidate ? pickPackageExportEntry(candidate) : null;
  }
  return null;
}

// Resolve a subpath (`.` or `./foo/bar`) against a `package.json#exports` map.
// Literal keys win over `./*`-style glob patterns; the longest glob prefix wins.
export function resolvePackageExportPath(exports: unknown, subpath: string): string | null {
  if (!exports || typeof exports !== "object") return null;
  const map = exports as Record<string, unknown>;

  if (subpath in map) return pickPackageExportEntry(map[subpath]);

  let bestKey: string | null = null;
  let bestPrefixLen = -1;
  for (const key of Object.keys(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    if (prefix.length > bestPrefixLen) {
      bestKey = key;
      bestPrefixLen = prefix.length;
    }
  }
  if (!bestKey) return null;

  const star = bestKey.indexOf("*");
  const captured = subpath.slice(
    bestKey.slice(0, star).length,
    subpath.length - bestKey.slice(star + 1).length,
  );
  const template = pickPackageExportEntry(map[bestKey]);
  if (!template) return null;
  return template.replaceAll("*", captured);
}

export function resolveContainedPackagePath(
  packagePath: string,
  entryPoint: string,
): string | null {
  const resolved = pathHelper.resolve(packagePath, entryPoint);
  const packagePathPrefix = packagePath.endsWith(pathHelper.SEPARATOR)
    ? packagePath
    : packagePath + pathHelper.SEPARATOR;
  return resolved === packagePath || resolved.startsWith(packagePathPrefix) ? resolved : null;
}
