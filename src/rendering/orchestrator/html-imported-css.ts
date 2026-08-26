import { join } from "#veryfront/compat/path";
import {
  normalizeCssModuleKey,
  rewriteCssModuleContent,
} from "#veryfront/transforms/css-modules/naming.ts";
import type { CSSImportReference } from "#veryfront/modules/react-loader/css-import-collector.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

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
  cssImports: Array<string | CSSImportReference> | undefined;
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
  const uniqueImports = new Map<
    string,
    { cssPath: string; normalizedCssPath: string; read?: () => Promise<string> }
  >();
  for (const cssImport of cssImports) {
    const cssPath = typeof cssImport === "string" ? cssImport : cssImport.readPath;
    const moduleKey = typeof cssImport === "string" ? cssImport : cssImport.moduleKey;
    const normalized = normalizeCssModuleKey(moduleKey);
    const identity = `${cssPath.length}:${cssPath}${normalized}`;
    if (!uniqueImports.has(identity)) {
      uniqueImports.set(identity, {
        cssPath,
        normalizedCssPath: normalized,
        ...(typeof cssImport === "string" || cssImport.read === undefined
          ? {}
          : { read: cssImport.read }),
      });
    }
  }

  const regularCssSegments: string[] = [];
  const moduleCssSegments: string[] = [];

  const orderedImports = [...uniqueImports.values()].toSorted((left, right) =>
    compareStrings(left.normalizedCssPath, right.normalizedCssPath) ||
    compareStrings(left.cssPath, right.cssPath)
  );
  for (const { cssPath, normalizedCssPath, read } of orderedImports) {
    if (normalizedCssPath === configuredStylesheetAbsolute) {
      continue;
    }

    try {
      const content = read ? await read() : await fs.readFile(cssPath);
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
