import { isAbsolute, join, relative } from "#veryfront/compat/path";
import {
  normalizeCssModuleKey,
  rewriteCssModuleContent,
} from "#veryfront/transforms/css-modules/naming.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const MAX_IMPORTED_STYLESHEETS = 1_000;
const MAX_COMBINED_CSS_BYTES = 10 * 1024 * 1024;

interface CssFsAdapterLike {
  readFile(path: string): Promise<string>;
}

interface CssLoggerLike {
  debug(message: string, context?: Record<string, unknown>): void;
}

interface MergeImportedCssOptions {
  fs: CssFsAdapterLike;
  logger: CssLoggerLike;
  projectDir: string;
  globalCSS: string | undefined;
  cssImports: string[] | undefined;
  stylesheetPath: string;
}

export async function mergeImportedCSS({
  fs,
  logger,
  projectDir,
  globalCSS,
  cssImports,
  stylesheetPath,
}: MergeImportedCssOptions): Promise<string | undefined> {
  if (!cssImports || cssImports.length === 0) return globalCSS;
  if (cssImports.length > MAX_IMPORTED_STYLESHEETS) {
    throw new RangeError("Imported stylesheet count exceeds the supported limit");
  }

  const normalizedStylesheetPath = normalizeProjectRelativePath(stylesheetPath);
  const configuredStylesheetAbsolute = normalizeCssModuleKey(
    join(projectDir, normalizedStylesheetPath),
  );
  const uniqueImports = new Map<string, string>();
  for (const cssPath of cssImports) {
    const absolutePath = isAbsolute(cssPath) ? cssPath : join(projectDir, cssPath);
    if (!isPathWithin(projectDir, absolutePath)) {
      throw new TypeError("Imported stylesheet is outside the project");
    }
    const normalized = normalizeCssModuleKey(absolutePath);
    if (!uniqueImports.has(normalized)) {
      uniqueImports.set(normalized, absolutePath);
    }
  }

  const sortedImports = [...uniqueImports.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const regularCssSegments: string[] = [];
  const moduleCssSegments: string[] = [];

  for (const [normalizedCssPath, cssPath] of sortedImports) {
    if (normalizedCssPath === configuredStylesheetAbsolute) {
      continue;
    }

    try {
      const content = await fs.readFile(cssPath);
      if (!content) continue;

      if (normalizedCssPath.endsWith(".module.css")) {
        moduleCssSegments.push(rewriteCssModuleContent(content, normalizedCssPath));
      } else {
        regularCssSegments.push(content);
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      logger.debug("Imported stylesheet was not found");
    }
  }

  if (regularCssSegments.length === 0 && moduleCssSegments.length === 0) return globalCSS;

  const combined = [globalCSS, ...regularCssSegments, ...moduleCssSegments]
    .filter(Boolean)
    .join("\n");
  if (new TextEncoder().encode(combined).byteLength > MAX_COMBINED_CSS_BYTES) {
    throw new RangeError("Combined imported CSS exceeds the supported size");
  }
  logger.debug("Merged imported CSS with global stylesheet", {
    importedCount: regularCssSegments.length + moduleCssSegments.length,
    regularCount: regularCssSegments.length,
    moduleCount: moduleCssSegments.length,
    totalLength: combined.length,
  });
  return combined;
}

function normalizeProjectRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Configured stylesheet path must be project-relative");
  }
  return normalized;
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate).replaceAll("\\", "/");
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}
