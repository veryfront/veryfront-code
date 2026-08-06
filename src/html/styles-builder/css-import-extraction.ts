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

/** Module extensions whose sources can carry CSS imports. */
export const CSS_IMPORTING_SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

/**
 * Static ESM import statements whose specifier ends in `.css`:
 *   import "./styles.css";
 *   import styles from "./button.module.css";
 * `[^'";]*` keeps the match from crossing statement boundaries, and `\bimport\b`
 * keeps identifiers that merely contain the word out of it -- without it,
 * `const important = "./styles.css"` reads as an import. That matters more here
 * than it looks: release-asset builds turn a bogus specifier into a fatal
 * coverage gap, so a false positive fails the release.
 */
const CSS_IMPORT_RE = /\bimport\b(?!\s*\.)[^'";]*['"]([^'"]+\.css)['"]/g;

/**
 * Blank out regions that look like code but are not.
 *
 * A specifier found here is not merely ignored downstream: the release-asset
 * build records anything it cannot resolve as a coverage gap, and gaps abort
 * the build. So a commented-out import to a since-deleted stylesheet would
 * block a project's releases permanently. Fenced blocks come first because
 * they are delimited by the same backticks as template literals.
 *
 * Replaced with equivalent-length blanks rather than removed so any offset a
 * caller derives from the result still lines up with the original source.
 */
function blankNonCodeRegions(source: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return source
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // Leading `[^:]` keeps the `//` in a URL like https://example.com from
    // being read as the start of a comment.
    .replace(
      /(^|[^:])(\/\/[^\n]*)/g,
      (_m, prefix: string, comment: string) => prefix + blank(comment),
    )
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, blank);
}

/** Extract the raw specifiers of all static CSS imports in a source file. */
export function extractCssImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of blankNonCodeRegions(source).matchAll(CSS_IMPORT_RE)) {
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
  const normalizedImporter = normalizePath(importerPath);
  const normalizedProjectDir = normalizePath(projectDir);

  let candidate: string;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const dirEnd = normalizedImporter.lastIndexOf("/");
    if (dirEnd <= 0) return null;
    candidate = `${normalizedImporter.slice(0, dirEnd)}/${specifier}`;
  } else if (specifier.startsWith("@/")) {
    candidate = `${normalizedProjectDir}/${specifier.slice(2)}`;
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

  return [...cssImports].sort();
}
