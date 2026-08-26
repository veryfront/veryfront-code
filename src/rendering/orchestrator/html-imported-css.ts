import { join } from "#veryfront/compat/path";
import {
  normalizeCssModuleKey,
  rewriteCssModuleContent,
} from "#veryfront/transforms/css-modules/naming.ts";
import type { CSSImportReference } from "#veryfront/modules/react-loader/css-import-collector.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const reflectApply = Reflect.apply;
const arrayJoin = Array.prototype.join;
const arraySort = Array.prototype.sort;
const mapConstructor = Map;
const mapForEach = Map.prototype.forEach;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const stringEndsWith = String.prototype.endsWith;
const stringReplace = String.prototype.replace;

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

  const normalizedStylesheetPath = reflectApply(stringReplace, stylesheetPath, [
    /^\/+/,
    "",
  ]) as string;
  const configuredStylesheetAbsolute = normalizeCssModuleKey(
    join(projectDir, normalizedStylesheetPath),
  );
  const uniqueImports = new mapConstructor<
    string,
    { cssPath: string; normalizedCssPath: string; read?: () => Promise<string> }
  >();
  for (let index = 0; index < cssImports.length; index++) {
    const cssImport = cssImports[index]!;
    const cssPath = typeof cssImport === "string" ? cssImport : cssImport.readPath;
    const moduleKey = typeof cssImport === "string" ? cssImport : cssImport.moduleKey;
    const normalized = normalizeCssModuleKey(moduleKey);
    const identity = `${cssPath.length}:${cssPath}${normalized}`;
    if (!(reflectApply(mapHas, uniqueImports, [identity]) as boolean)) {
      reflectApply(mapSet, uniqueImports, [identity, {
        cssPath,
        normalizedCssPath: normalized,
        ...(typeof cssImport === "string" || cssImport.read === undefined
          ? {}
          : { read: cssImport.read }),
      }]);
    }
  }

  const regularCssSegments: string[] = [];
  const moduleCssSegments: string[] = [];

  const orderedImports: Array<{
    cssPath: string;
    normalizedCssPath: string;
    read?: () => Promise<string>;
  }> = [];
  reflectApply(mapForEach, uniqueImports, [
    (entry: (typeof orderedImports)[number]) => {
      orderedImports[orderedImports.length] = entry;
    },
  ]);
  reflectApply(arraySort, orderedImports, [
    (left: (typeof orderedImports)[number], right: (typeof orderedImports)[number]) =>
      compareStrings(left.normalizedCssPath, right.normalizedCssPath) ||
      compareStrings(left.cssPath, right.cssPath),
  ]);
  for (let index = 0; index < orderedImports.length; index++) {
    const { cssPath, normalizedCssPath, read } = orderedImports[index]!;
    if (normalizedCssPath === configuredStylesheetAbsolute) {
      continue;
    }

    try {
      const content = read ? await read() : await fs.readFile(cssPath);
      if (!content) continue;

      if (reflectApply(stringEndsWith, normalizedCssPath, [".module.css"]) as boolean) {
        moduleCssSegments[moduleCssSegments.length] = rewriteCssModuleContent(
          content,
          normalizedCssPath,
        );
      } else {
        regularCssSegments[regularCssSegments.length] = content;
      }
    } catch (_) {
      logger.debug("Could not load imported CSS file", { cssPath });
    }
  }

  if (regularCssSegments.length === 0 && moduleCssSegments.length === 0) return globalCSS;

  const segments: string[] = [];
  if (globalCSS) segments[segments.length] = globalCSS;
  for (let index = 0; index < regularCssSegments.length; index++) {
    segments[segments.length] = regularCssSegments[index]!;
  }
  for (let index = 0; index < moduleCssSegments.length; index++) {
    segments[segments.length] = moduleCssSegments[index]!;
  }
  const combined = reflectApply(arrayJoin, segments, ["\n"]) as string;
  logger.debug("Merged imported CSS with global stylesheet", {
    importedCount: regularCssSegments.length + moduleCssSegments.length,
    regularCount: regularCssSegments.length,
    moduleCount: moduleCssSegments.length,
    totalLength: combined.length,
  });
  return combined;
}
