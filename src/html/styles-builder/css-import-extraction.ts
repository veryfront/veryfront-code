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
 * Extraction is intentionally text-based, like CSS candidate scanning:
 * it must stay cheap enough to run on every stylesheet compile and must not
 * depend on bundler/parser extensions being registered. Unresolvable or
 * unreadable specifiers are skipped downstream, so over-matching is harmless.
 *
 * @module html/styles-builder/css-import-extraction
 */

import { isWithinDirectory, normalizePath } from "#veryfront/utils/path-utils.ts";
import { MAX_CSS_FILES, MAX_CSS_TOTAL_BYTES } from "#veryfront/utils/constants/css.ts";
import { assertCSSFileContent } from "#veryfront/utils/css-content-admission.ts";
import { assertBoundedPathString } from "#veryfront/utils/project-relative-path.ts";

/** Module extensions whose sources can carry CSS imports. */
export const CSS_IMPORTING_SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

/**
 * Static ESM import statements whose specifier ends in `.css`:
 *   import "./styles.css";
 *   import styles from "./button.module.css";
 * `[^'";]*` keeps the match from crossing statement boundaries.
 */
const CSS_IMPORT_RE = /import[^'";]*['"]([^'"]+\.css)['"]/g;

function extractAdmittedCssImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(CSS_IMPORT_RE)) {
    if (!match[1]) continue;
    if (specifiers.length >= MAX_CSS_FILES) {
      throw new TypeError(`CSS source cannot import more than ${MAX_CSS_FILES} files`);
    }
    specifiers.push(assertBoundedPathString(match[1], "CSS import specifier"));
  }
  return specifiers;
}

/** Extract the raw specifiers of all static CSS imports in a source file. */
export function extractCssImportSpecifiers(source: string): string[] {
  assertCSSFileContent(source, "CSS import source");
  return extractAdmittedCssImportSpecifiers(source);
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
 * Supports `./`/`../` (relative to the importing file), the `@/` project
 * alias, and project-root `/` paths. Bare and URL specifiers are ignored.
 * Returns null when the resolved path would escape the project directory.
 */
export function resolveCssImportPath(
  specifier: string,
  importerPath: string,
  projectDir: string,
): string | null {
  const admittedSpecifier = assertBoundedPathString(specifier, "CSS import specifier");
  const normalizedImporter = normalizePath(
    assertBoundedPathString(importerPath, "CSS import source path"),
  );
  const normalizedProjectDir = normalizePath(
    assertBoundedPathString(projectDir, "CSS import project directory"),
  );

  let candidate: string;
  if (admittedSpecifier.startsWith("./") || admittedSpecifier.startsWith("../")) {
    const dirEnd = normalizedImporter.lastIndexOf("/");
    if (dirEnd <= 0) return null;
    candidate = `${normalizedImporter.slice(0, dirEnd)}/${admittedSpecifier}`;
  } else if (admittedSpecifier.startsWith("@/")) {
    candidate = `${normalizedProjectDir}/${admittedSpecifier.slice(2)}`;
  } else if (admittedSpecifier.startsWith("/")) {
    candidate = `${normalizedProjectDir}/${admittedSpecifier.replace(/^\/+/, "")}`;
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
  const admittedProjectDir = assertBoundedPathString(
    projectDir,
    "CSS import project directory",
  );
  const cssImports = new Set<string>();
  let sourceFileCount = 0;
  let sourceBytes = 0;

  for (const file of files) {
    sourceFileCount++;
    if (sourceFileCount > MAX_CSS_FILES) {
      throw new TypeError(`CSS import extraction exceeds ${MAX_CSS_FILES} source files`);
    }
    const importerPath = assertBoundedPathString(file.path, "CSS import source path");
    const contentBytes = assertCSSFileContent(file.content, `CSS import source ${importerPath}`);
    if (contentBytes > MAX_CSS_TOTAL_BYTES - sourceBytes) {
      throw new TypeError(`CSS import sources exceed ${MAX_CSS_TOTAL_BYTES} total bytes`);
    }
    sourceBytes += contentBytes;
    // Cheap pre-filter before running the regex against large files.
    if (!file.content.includes(".css")) continue;

    for (const specifier of extractAdmittedCssImportSpecifiers(file.content)) {
      const resolved = resolveCssImportPath(specifier, importerPath, admittedProjectDir);
      if (!resolved || cssImports.has(resolved)) continue;
      if (cssImports.size >= MAX_CSS_FILES) {
        throw new TypeError(`CSS imports exceed ${MAX_CSS_FILES} files`);
      }
      cssImports.add(resolved);
    }
  }

  return [...cssImports].sort();
}
