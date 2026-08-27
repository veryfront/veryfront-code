/**
 * CSS Import Extraction
 *
 * Pure helpers for discovering CSS files imported by project source modules
 * (side-effect imports like `import "./styles.css"` in app/layout.tsx, `@/`
 * alias imports, and CSS module imports).
 *
 * The production SSR pipeline collects CSS imports while loading modules and
 * merges them into the page stylesheet. Two other stylesheet producers have no
 * module-loading pass and recover the same information with these helpers:
 * the dev/preview /_vf_styles/styles.css route and the release-asset build
 * executor.
 *
 * Extraction is intentionally text-based (like Tailwind candidate scanning):
 * it must stay cheap enough to run on every stylesheet compile and must not
 * depend on bundler/parser extensions being registered. Unresolvable or
 * unreadable specifiers are skipped downstream, so over-matching is harmless.
 *
 * @module html/styles-builder/css-import-extraction
 */

import { isWithinDirectory, normalizePath } from "#veryfront/utils/path-utils.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { splitSpecifierSuffix } from "#veryfront/transforms/shared/specifier-suffix.ts";

/** Module extensions whose sources can carry CSS imports. */
export const CSS_IMPORTING_SOURCE_EXTENSIONS = [
  ".tsx",
  ".jsx",
  ".mdx",
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

/**
 * ESM imports whose specifier path ends in `.css`, with an optional suffix:
 *   import "./styles.css";
 *   import styles from "./button.module.css";
 *   import("./theme.css")
 *   import "./theme.css#release";
 *
 * Dynamic imports are matched on purpose, despite this once being described as
 * static-only. `import("./theme.css")` loads that stylesheet at runtime, so
 * leaving it out means the compiled stylesheet is missing CSS the page actually
 * uses. A dynamic specifier pointing at a file that does not exist is a broken
 * reference, not a false positive -- exactly as a static one would be.
 * `[^'";]*` keeps the match from crossing statement boundaries, and `\bimport\b`
 * keeps identifiers that merely contain the word out of it -- without it,
 * `const important = "./styles.css"` reads as an import. That matters more here
 * than it looks: release-asset builds turn a bogus specifier into a fatal
 * coverage gap, so a false positive fails the release.
 */
const CSS_IMPORT_RE = /\bimport\b(?!\s*\.)[^'";]*['"]([^'"]+\.css(?:[?#][^'"]*)?)['"]/g;

/**
 * Extract the raw specifiers of all CSS imports in a source file.
 *
 * Deliberately loose, per this module's contract: over-matching is harmless
 * because unresolvable specifiers are skipped downstream. A commented-out or
 * quoted `import "./x.css"` will be reported, and that is fine.
 *
 * An earlier revision blanked comments, template literals and fenced blocks
 * before matching, because the release-asset build had made this function's
 * output fatal. That was the wrong layer to fix it: telling code from prose
 * with a regex kept finding new holes, and worse, an unpaired `/*` or backtick
 * blanked across intervening real code and silently dropped a genuine import --
 * trading a loud failure for a page shipped without its stylesheet. The build
 * no longer gaps on what it cannot resolve, so the looseness costs nothing.
 */
export function extractCssImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(CSS_IMPORT_RE)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolve `.`/`..` segments; returns null if the path escapes its root. */
function collapseSegments(path: string): string | null {
  const segments = path.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "." || (segment === "" && out.length > 0)) continue;
    if (segment === "..") {
      if (out.length <= 1) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/") || "/";
}

/**
 * Resolve a CSS import specifier to an absolute project path.
 * Supports `./`/`../` (relative to the importing file) and the `@/` project
 * alias. Bare and URL specifiers are ignored. Returns null when the resolved
 * path would escape the project directory.
 */
export function resolveCssImportPath(
  specifier: string,
  importerPath: string,
  projectDir: string,
): string | null {
  const specifierPath = splitSpecifierSuffix(specifier).path;
  const normalizedImporter = normalizePath(importerPath);
  const normalizedProjectDir = normalizePath(projectDir);

  let candidate: string;
  if (specifierPath.startsWith("./") || specifierPath.startsWith("../")) {
    const dirEnd = normalizedImporter.lastIndexOf("/");
    if (dirEnd <= 0) return null;
    candidate = `${normalizedImporter.slice(0, dirEnd)}/${specifierPath}`;
  } else if (specifierPath.startsWith("@/")) {
    candidate = `${normalizedProjectDir}/${specifierPath.slice(2)}`;
  } else {
    return null;
  }

  const collapsed = collapseSegments(normalizePath(candidate));
  if (!collapsed) return null;
  if (!isWithinDirectory(normalizedProjectDir, collapsed)) return null;
  return collapsed;
}

/**
 * Collect the resolved absolute paths of all CSS files imported by the given
 * source files, deduplicated and sorted for deterministic output.
 */
export function collectCssImportPaths(
  files: Iterable<{ path: string; content: string }>,
  projectDir: string,
): string[] {
  const cssImports = new Set<string>();

  for (const file of files) {
    // Cheap pre-filter before running the regex against large files.
    if (!file.content.includes(".css")) continue;

    for (const specifier of extractCssImportSpecifiers(file.content)) {
      const resolved = resolveCssImportPath(specifier, file.path, projectDir);
      if (resolved) cssImports.add(resolved);
    }
  }

  return [...cssImports].sort(compareStrings);
}
