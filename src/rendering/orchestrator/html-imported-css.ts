import { join } from "#veryfront/compat/path";
import {
  normalizeCssModuleKey,
  rewriteCssModuleContent,
} from "#veryfront/transforms/css-modules/naming.ts";

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

  const normalizedStylesheetPath = stylesheetPath.replace(/^\/+/, "");
  const configuredStylesheetAbsolute = normalizeCssModuleKey(
    join(projectDir, normalizedStylesheetPath),
  );
  const uniqueImports = new Map<string, string>();
  for (const cssPath of cssImports) {
    const normalized = normalizeCssModuleKey(cssPath);
    if (!uniqueImports.has(normalized)) {
      uniqueImports.set(normalized, cssPath);
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
    } catch (_) {
      logger.debug("Could not load imported CSS file", { cssPath });
    }
  }

  if (regularCssSegments.length === 0 && moduleCssSegments.length === 0) return globalCSS;

  const combined = [globalCSS, ...regularCssSegments, ...moduleCssSegments]
    .filter(Boolean)
    .join("\n");
  logger.debug("Merged imported CSS with global stylesheet", {
    importedCount: regularCssSegments.length + moduleCssSegments.length,
    regularCount: regularCssSegments.length,
    moduleCount: moduleCssSegments.length,
    totalLength: combined.length,
  });
  return combined;
}
