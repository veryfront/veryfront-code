import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  normalizeCssModuleKey,
  rewriteCssModuleContent,
  toProjectRelativeCssModuleKey,
} from "#veryfront/transforms/css-modules/naming.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import {
  assertCSSFileContent,
  assertCSSOutputContent,
} from "#veryfront/utils/css-content-admission.ts";
import {
  assertBoundedPathString,
  assertCanonicalProjectRelativePath,
} from "#veryfront/utils/project-relative-path.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

interface CssFsAdapterLike {
  readFile(path: string): Promise<string>;
  readFileBytes?(path: string): Promise<Uint8Array>;
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  readonly maxWholeFileReadBytes?: number;
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

function snapshotCSSImportPaths(value: unknown): string[] {
  if (value === undefined) return [];
  try {
    if (isProxyWithoutHooks(value)) {
      throw new TypeError("CSS imports must not be a Proxy");
    }
    if (!Array.isArray(value)) {
      throw new TypeError("CSS imports must be an array");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CSS_FILES) {
      throw new TypeError(`CSS imports cannot exceed ${MAX_CSS_FILES} files`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1) {
      throw new TypeError("CSS imports must be a dense data-property array");
    }
    const snapshot = new Array<string>(length);
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      ) {
        throw new TypeError("CSS imports must be a dense data-property array of paths");
      }
      snapshot[index] = descriptor.value;
    }
    for (const key of ownKeys) {
      if (key === "length") continue;
      if (
        typeof key !== "string" ||
        !/^\d+$/.test(key) ||
        Number(key) >= length ||
        String(Number(key)) !== key
      ) {
        throw new TypeError("CSS imports must be a dense data-property array");
      }
    }
    return snapshot;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("CSS imports could not be inspected safely", { cause: error });
  }
}

function resolveImportedCSSProjectRoot(projectDir: string): string {
  const admittedProjectDir = assertBoundedPathString(
    projectDir,
    "Imported CSS project directory",
  );
  if (!isAbsolute(admittedProjectDir)) {
    throw new TypeError("Imported CSS project directory must be absolute");
  }
  return resolve(admittedProjectDir);
}

function resolveImportedCSSPath(path: string, projectDir: string): string {
  const admittedPath = assertBoundedPathString(path, "Imported CSS path");
  const projectRoot = resolveImportedCSSProjectRoot(projectDir);
  if (!isAbsolute(admittedPath)) {
    const relativePath = assertCanonicalProjectRelativePath(admittedPath, "Imported CSS path");
    return resolve(projectRoot, relativePath);
  }

  const absolutePath = resolve(admittedPath);
  const relativePath = relative(projectRoot, absolutePath).replaceAll("\\", "/");
  const canonicalRelative = assertCanonicalProjectRelativePath(relativePath, "Imported CSS path");
  if (resolve(projectRoot, canonicalRelative) !== absolutePath) {
    throw new TypeError("Imported CSS path must resolve within the project");
  }
  return absolutePath;
}

export async function mergeImportedCSS({
  fs,
  logger,
  projectDir,
  globalCSS,
  cssImports,
  stylesheetPath,
}: MergeImportedCssOptions): Promise<string | undefined> {
  const projectRoot = resolveImportedCSSProjectRoot(projectDir);
  const importPaths = snapshotCSSImportPaths(cssImports);
  let sourceBytes = globalCSS === undefined
    ? 0
    : assertCSSFileContent(globalCSS, "Global CSS input");
  let mergedBytes = sourceBytes;
  if (importPaths.length === 0) return globalCSS;

  const normalizedStylesheetPath = assertBoundedPathString(
    stylesheetPath,
    "Configured stylesheet path",
  ).replace(/^\/+/, "");
  const configuredStylesheetAbsolute = normalizeCssModuleKey(
    join(projectRoot, normalizedStylesheetPath),
  );
  const uniqueImports = new Map<string, string>();
  for (const cssPath of importPaths) {
    const resolvedPath = resolveImportedCSSPath(cssPath, projectRoot);
    const normalized = normalizeCssModuleKey(resolvedPath);
    if (!uniqueImports.has(normalized)) {
      uniqueImports.set(normalized, resolvedPath);
    }
  }

  const sortedImports = [...uniqueImports.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const regularCssSegments: string[] = [];
  const moduleCssSegments: string[] = [];
  const importedCSSReader = captureBoundedTextReader(
    fs,
    "Imported CSS filesystem",
  );

  for (const [normalizedCssPath, cssPath] of sortedImports) {
    if (normalizedCssPath === configuredStylesheetAbsolute) {
      continue;
    }

    const { content, byteLength: contentBytes } = await importedCSSReader.readUtf8(
      cssPath,
      MAX_CSS_FILE_BYTES,
      `Imported CSS file ${cssPath}`,
    );
    if (!content) continue;
    if (contentBytes > MAX_CSS_TOTAL_BYTES - sourceBytes) {
      throw new TypeError(`Imported CSS exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`);
    }
    sourceBytes += contentBytes;

    if (normalizedCssPath.endsWith(".module.css")) {
      const moduleKey = toProjectRelativeCssModuleKey(normalizedCssPath, projectRoot);
      const rewritten = rewriteCssModuleContent(content, moduleKey);
      assertCSSOutputContent(rewritten, `Rewritten CSS module ${cssPath}`);
      const rewrittenBytes = utf8ByteLength(rewritten, MAX_CSS_OUTPUT_FILE_BYTES);
      if (rewrittenBytes > MAX_CSS_OUTPUT_FILE_BYTES - mergedBytes) {
        throw new TypeError(`Merged CSS exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} total bytes`);
      }
      mergedBytes += rewrittenBytes;
      moduleCssSegments.push(rewritten);
    } else {
      if (contentBytes > MAX_CSS_OUTPUT_FILE_BYTES - mergedBytes) {
        throw new TypeError(`Merged CSS exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} total bytes`);
      }
      mergedBytes += contentBytes;
      regularCssSegments.push(content);
    }
  }

  if (regularCssSegments.length === 0 && moduleCssSegments.length === 0) return globalCSS;

  const segments = [globalCSS, ...regularCssSegments, ...moduleCssSegments].filter(
    (segment): segment is string => Boolean(segment),
  );
  const separatorBytes = Math.max(0, segments.length - 1);
  if (separatorBytes > MAX_CSS_OUTPUT_FILE_BYTES - mergedBytes) {
    throw new TypeError(`Merged CSS exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} total bytes`);
  }
  const combined = segments.join("\n");
  logger.debug("Merged imported CSS with global stylesheet", {
    importedCount: regularCssSegments.length + moduleCssSegments.length,
    regularCount: regularCssSegments.length,
    moduleCount: moduleCssSegments.length,
    totalLength: combined.length,
  });
  return combined;
}
