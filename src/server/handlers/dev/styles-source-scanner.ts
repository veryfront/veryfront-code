import type { HandlerContext } from "../types.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import { validatePath, validatePathSync } from "#veryfront/security";
import { isWithinDirectory, normalizePath } from "#veryfront/utils/path-utils.ts";
import {
  MAX_STYLE_SOURCE_FILE_BYTES,
  MAX_STYLE_SOURCE_FILES,
  MAX_STYLE_SOURCE_PATH_BYTES,
  MAX_TOTAL_STYLE_SOURCE_BYTES,
  utf8ByteLength,
} from "#veryfront/html/styles-builder/resource-limits.ts";
import {
  createStyleScopeProfile,
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";

const MAX_SOURCE_ENTRIES = 100_000;
const MAX_SOURCE_DEPTH = 64;

interface SourceFileProvider {
  getAllSourceFiles?: () =>
    | Array<{ path: string; content?: string }>
    | Promise<Array<{ path: string; content?: string }>>;
}

export interface CollectedStyleSourceFile {
  path: string;
  content: string;
}

interface CollectStyleSourceFilesOptions {
  extensions: readonly string[];
}

function assertBoundedPath(path: unknown): asserts path is string {
  if (
    typeof path !== "string" || path.length === 0 || path.length > MAX_STYLE_SOURCE_PATH_BYTES ||
    utf8ByteLength(path) > MAX_STYLE_SOURCE_PATH_BYTES
  ) {
    throw new TypeError("Style source path is invalid");
  }
}

function boundedSourceByteLength(content: string): number {
  if (content.length > MAX_STYLE_SOURCE_FILE_BYTES) {
    throw new TypeError("Style source file exceeds the size limit");
  }
  const bytes = utf8ByteLength(content);
  if (bytes > MAX_STYLE_SOURCE_FILE_BYTES) {
    throw new TypeError("Style source file exceeds the size limit");
  }
  return bytes;
}

function toContainedAbsolutePath(path: string, projectDir: string): string | null {
  const absolutePath = normalizePath(isAbsolute(path) ? path : join(projectDir, path));
  if (!isWithinDirectory(projectDir, absolutePath)) return null;

  const projectRelativePath = relative(projectDir, absolutePath);
  const lexicalResult = validatePathSync(projectRelativePath, {
    baseDir: projectDir,
    allowAbsolute: false,
    level: "strict",
  });
  return lexicalResult.valid ? absolutePath : null;
}

async function resolvePhysicalSourcePath(
  path: string,
  ctx: HandlerContext,
): Promise<string> {
  const projectRelativePath = relative(ctx.projectDir, path);
  const result = await validatePath(projectRelativePath, {
    baseDir: ctx.projectDir,
    allowAbsolute: false,
    level: "normal",
    adapter: ctx.adapter,
    followSymlinks: true,
  });
  if (!result.valid || !result.canonicalPath) {
    throw new TypeError("Style source path is outside the project");
  }
  assertBoundedPath(result.canonicalPath);
  return result.canonicalPath;
}

async function readSourceFile(
  path: string,
  ctx: HandlerContext,
): Promise<string | null> {
  const canonicalPath = await resolvePhysicalSourcePath(path, ctx);
  let info: Awaited<ReturnType<HandlerContext["adapter"]["fs"]["stat"]>>;
  try {
    info = await ctx.adapter.fs.stat(canonicalPath);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  if (!info.isFile) throw new TypeError("Style source path must reference a file");
  if (info.size > MAX_STYLE_SOURCE_FILE_BYTES) {
    throw new TypeError("Style source file exceeds the size limit");
  }

  try {
    const content = await ctx.adapter.fs.readFile(canonicalPath);
    boundedSourceByteLength(content);
    return content;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function createCollector() {
  const files: CollectedStyleSourceFile[] = [];
  let totalBytes = 0;

  return {
    add(path: string, content: string): void {
      if (files.length >= MAX_STYLE_SOURCE_FILES) {
        throw new TypeError("Style source file count exceeds the limit");
      }
      const contentBytes = boundedSourceByteLength(content);
      totalBytes += contentBytes;
      if (totalBytes > MAX_TOTAL_STYLE_SOURCE_BYTES) {
        throw new TypeError("Style source files exceed the total size limit");
      }
      files.push({ path, content });
    },
    files,
  };
}

async function collectProvidedSourceFiles(
  provider: SourceFileProvider,
  ctx: HandlerContext,
  options: CollectStyleSourceFilesOptions,
): Promise<CollectedStyleSourceFile[]> {
  const suppliedFiles = await provider.getAllSourceFiles!();
  if (!Array.isArray(suppliedFiles) || suppliedFiles.length > MAX_SOURCE_ENTRIES) {
    throw new TypeError("Style source entry count exceeds the limit");
  }

  const styleProfile = createStyleScopeProfile(ctx.config);
  const collector = createCollector();
  for (const file of suppliedFiles) {
    if (!file || typeof file !== "object") throw new TypeError("Style source file is invalid");
    assertBoundedPath(file.path);
    if (!options.extensions.some((extension) => file.path.endsWith(extension))) continue;

    const absolutePath = toContainedAbsolutePath(file.path, ctx.projectDir);
    if (!absolutePath) continue;
    if (!shouldIncludeStylePath(styleProfile, absolutePath, ctx.projectDir)) continue;

    let content = file.content;
    if (content !== undefined && typeof content !== "string") {
      throw new TypeError("Style source file content must be a string");
    }
    content ??= await readSourceFile(absolutePath, ctx) ?? undefined;
    if (content === undefined) continue;
    collector.add(absolutePath, content);
  }
  return collector.files;
}

async function collectLocalSourceFiles(
  ctx: HandlerContext,
  options: CollectStyleSourceFilesOptions,
): Promise<CollectedStyleSourceFile[]> {
  const styleProfile = createStyleScopeProfile(ctx.config);
  const collector = createCollector();
  let visitedEntries = 0;

  const scanDirectory = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth > MAX_SOURCE_DEPTH) {
      throw new TypeError("Style source directory depth exceeds the limit");
    }

    try {
      for await (const entry of ctx.adapter.fs.readDir(directoryPath)) {
        visitedEntries++;
        if (visitedEntries > MAX_SOURCE_ENTRIES) {
          throw new TypeError("Style source entry count exceeds the limit");
        }
        if (entry.isSymlink) continue;
        assertBoundedPath(entry.name);

        const fullPath = join(directoryPath, entry.name);
        assertBoundedPath(fullPath);
        if (entry.isDirectory) {
          if (shouldTraverseStyleDirectory(styleProfile, fullPath, ctx.projectDir)) {
            await scanDirectory(fullPath, depth + 1);
          }
          continue;
        }
        if (!entry.isFile) continue;
        if (!options.extensions.some((extension) => entry.name.endsWith(extension))) continue;
        if (!shouldIncludeStylePath(styleProfile, fullPath, ctx.projectDir)) continue;

        const content = await readSourceFile(fullPath, ctx);
        if (content !== null) collector.add(fullPath, content);
      }
    } catch (error) {
      if (depth > 0 && isNotFoundError(error)) return;
      throw error;
    }
  };

  await scanDirectory(ctx.projectDir, 0);
  return collector.files;
}

/** Collect bounded, project-contained source text for stylesheet analysis. */
export async function collectStyleSourceFiles(
  ctx: HandlerContext,
  options: CollectStyleSourceFilesOptions,
): Promise<CollectedStyleSourceFile[]> {
  assertBoundedPath(ctx.projectDir);
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  const provider = typeof wrappedFs.getUnderlyingAdapter === "function"
    ? wrappedFs.getUnderlyingAdapter() as SourceFileProvider
    : undefined;

  return typeof provider?.getAllSourceFiles === "function"
    ? collectProvidedSourceFiles(provider, ctx, options)
    : collectLocalSourceFiles(ctx, options);
}
