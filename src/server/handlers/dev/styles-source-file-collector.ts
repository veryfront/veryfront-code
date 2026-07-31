/**
 * Bounded source snapshot used by request-time CSS import and candidate scans.
 *
 * Remote filesystem listings are extension-boundary data and are admitted as
 * dense, accessor-free arrays before any entry is inspected. Local projects
 * reuse the secure HTML source collector so both paths share one resource
 * policy.
 */

import { isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { collectCSSCandidateSourceFiles } from "#veryfront/html/styles-builder/css-source-collector.ts";
import { CSS_IMPORTING_SOURCE_EXTENSIONS } from "#veryfront/html/styles-builder/css-import-extraction.ts";
import {
  createStyleScopeProfile,
  shouldIncludeStylePath,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { createSecureFs } from "#veryfront/security";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import {
  assertBoundedPathString,
  assertCanonicalProjectRelativePath,
} from "#veryfront/utils/project-relative-path.ts";
import { assertCSSFileContent } from "#veryfront/utils/css-content-admission.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../types.ts";

const logger = serverLogger.component("styles-source-file-collector");

export interface ProjectStyleSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface StyleSourceProvider {
  getAllSourceFiles?: () => unknown | Promise<unknown>;
  getContentContext?: () => ResolvedContentContext | null;
}

function snapshotOptionalMethod(
  value: object,
  key: string,
  label: string,
): ((...args: never[]) => unknown) | undefined {
  let owner: object | null = value;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (isProxyWithoutHooks(owner)) {
      throw new TypeError(`${label} must not be a Proxy`);
    }
    if (seen.has(owner)) {
      throw new TypeError(`${label} has an invalid prototype chain`);
    }
    seen.add(owner);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
    } catch (cause) {
      throw new TypeError(`${label} could not be inspected safely`, { cause });
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        throw new TypeError(`${label} ${key} must be a data-property function`);
      }
      if (descriptor.value === undefined) return undefined;
      if (
        typeof descriptor.value !== "function" ||
        isProxyWithoutHooks(descriptor.value)
      ) {
        throw new TypeError(`${label} ${key} must be a non-Proxy function`);
      }
      return descriptor.value as (...args: never[]) => unknown;
    }
    try {
      owner = Object.getPrototypeOf(owner);
    } catch (cause) {
      throw new TypeError(`${label} could not be inspected safely`, { cause });
    }
  }
  if (owner !== null) throw new TypeError(`${label} prototype chain is too deep`);
  return undefined;
}

export function resolveStyleSourceProvider(
  ctx: HandlerContext,
): StyleSourceProvider | undefined {
  // HandlerContext and its adapter wrapper are constructed by core. Treat only
  // that outer lookup as trusted; the underlying provider and every capability
  // it exposes remain extension-owned and are snapshotted without hooks.
  const wrappedFs = ctx.adapter.fs;
  const getUnderlyingAdapter = snapshotOptionalMethod(
    wrappedFs,
    "getUnderlyingAdapter",
    "CSS source filesystem wrapper",
  );
  if (getUnderlyingAdapter === undefined) return undefined;

  const provider = Reflect.apply(getUnderlyingAdapter, wrappedFs, []);
  if (
    typeof provider !== "object" ||
    provider === null ||
    Array.isArray(provider) ||
    isProxyWithoutHooks(provider)
  ) {
    throw new TypeError("CSS source provider must be a non-Proxy object");
  }
  const getAllSourceFiles = snapshotOptionalMethod(
    provider,
    "getAllSourceFiles",
    "CSS source provider",
  );
  const getContentContext = snapshotOptionalMethod(
    provider,
    "getContentContext",
    "CSS source provider",
  );
  return Object.freeze({
    ...(getAllSourceFiles === undefined
      ? {}
      : {
        getAllSourceFiles: () =>
          Reflect.apply(getAllSourceFiles, provider, []) as unknown | Promise<unknown>,
      }),
    ...(getContentContext === undefined
      ? {}
      : {
        getContentContext: () =>
          Reflect.apply(getContentContext, provider, []) as ResolvedContentContext | null,
      }),
  });
}

function snapshotDenseListing(value: unknown): unknown[] {
  let lengthDescriptor: PropertyDescriptor | undefined;
  let ownKeys: PropertyKey[];
  try {
    if (isProxyWithoutHooks(value)) {
      throw new TypeError("CSS source listing must not be a Proxy");
    }
    if (!Array.isArray(value)) {
      throw new TypeError("CSS source listing must be an array");
    }
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CSS_FILES) {
      throw new TypeError(`CSS source listing exceeds ${MAX_CSS_FILES} entries`);
    }
    ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1) {
      throw new TypeError("CSS source listing must be a dense data-property array");
    }

    const snapshot = new Array<unknown>(length);
    for (const key of ownKeys) {
      if (key === "length") continue;
      if (typeof key !== "string") {
        throw new TypeError("CSS source listing must be a dense data-property array");
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
        throw new TypeError("CSS source listing must be a dense data-property array");
      }
    }
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("CSS source listing must be a dense data-property array");
      }
      snapshot[index] = descriptor.value;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("CSS source listing could not be inspected safely", { cause: error });
  }
}

function readEntryDataProperty(
  entry: object,
  key: "path" | "content",
  required: boolean,
): unknown {
  if (isProxyWithoutHooks(entry)) {
    throw new TypeError("CSS source entries must not be a Proxy");
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(entry, key);
  } catch (error) {
    throw new TypeError("CSS source entries could not be inspected safely", { cause: error });
  }
  if (!descriptor) {
    if (required) throw new TypeError(`CSS source entries must define ${key} as data properties`);
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`CSS source entries must define ${key} as data properties`);
  }
  return descriptor.value;
}

function resolveRemoteProjectRoot(projectDir: string): string {
  const admittedProjectDir = assertBoundedPathString(
    projectDir,
    "CSS source project directory",
  );
  if (!isAbsolute(admittedProjectDir)) {
    throw new TypeError("CSS source project directory must be absolute");
  }
  return resolve(admittedProjectDir);
}

function resolveRemoteSourcePath(path: unknown, projectDir: string): string {
  const admittedPath = assertBoundedPathString(path, "CSS source path");
  const projectRoot = resolveRemoteProjectRoot(projectDir);
  if (!isAbsolute(admittedPath)) {
    const relativePath = assertCanonicalProjectRelativePath(admittedPath, "CSS source path");
    return resolve(projectRoot, relativePath);
  }

  const absolutePath = resolve(admittedPath);
  const relativePath = relative(projectRoot, absolutePath).replaceAll("\\", "/");
  const canonicalRelative = assertCanonicalProjectRelativePath(relativePath, "CSS source path");
  const resolvedFromRoot = resolve(projectRoot, canonicalRelative);
  if (resolvedFromRoot !== absolutePath) {
    throw new TypeError("CSS source path must resolve within the project");
  }
  return absolutePath;
}

function isCandidateSource(path: string): boolean {
  const lowercasePath = path.toLowerCase();
  return CSS_IMPORTING_SOURCE_EXTENSIONS.some((extension) => lowercasePath.endsWith(extension));
}

async function snapshotRemoteSourceFiles(
  ctx: HandlerContext,
  listing: unknown,
): Promise<ProjectStyleSourceFile[]> {
  const entries = snapshotDenseListing(listing);
  const projectRoot = resolveRemoteProjectRoot(ctx.projectDir);
  const styleProfile = createStyleScopeProfile(ctx.config);
  const files: ProjectStyleSourceFile[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;
  let sourceReader: ReturnType<typeof captureBoundedTextReader> | undefined;

  for (const candidate of entries) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new TypeError("CSS source entries must be objects with data properties");
    }
    const path = resolveRemoteSourcePath(
      readEntryDataProperty(candidate, "path", true),
      projectRoot,
    );
    if (seenPaths.has(path)) {
      throw new TypeError(`CSS source listing contains a duplicate path: ${path}`);
    }
    seenPaths.add(path);

    if (
      !isCandidateSource(path) ||
      !shouldIncludeStylePath(styleProfile, path, projectRoot)
    ) {
      continue;
    }

    const suppliedContent = readEntryDataProperty(candidate, "content", false);
    let content: string;
    let contentBytes: number;
    if (suppliedContent === undefined) {
      sourceReader ??= captureBoundedTextReader(
        createSecureFs({
          baseDir: projectRoot,
          adapter: ctx.adapter,
          context: "build",
          validationOptions: { followSymlinks: false },
        }),
        "Remote CSS source filesystem",
      );
      const source = await sourceReader.readUtf8(
        path,
        MAX_CSS_FILE_BYTES,
        `CSS source file ${path}`,
      );
      content = source.content;
      contentBytes = source.byteLength;
    } else {
      if (typeof suppliedContent !== "string") {
        throw new TypeError("CSS source entry content must be a string when present");
      }
      content = suppliedContent;
      contentBytes = assertCSSFileContent(content, `CSS source file ${path}`);
    }
    if (contentBytes > MAX_CSS_TOTAL_BYTES - totalBytes) {
      throw new TypeError(`CSS source content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`);
    }
    totalBytes += contentBytes;
    files.push(Object.freeze({ path, content }));
  }

  files.sort((left, right) => left.path === right.path ? 0 : left.path < right.path ? -1 : 1);
  return files;
}

/** Capture one bounded project source snapshot for all request-time CSS scans. */
export async function collectProjectStyleSourceFiles(
  ctx: HandlerContext,
): Promise<ProjectStyleSourceFile[]> {
  const provider = resolveStyleSourceProvider(ctx);
  if (typeof provider?.getAllSourceFiles === "function") {
    return await snapshotRemoteSourceFiles(
      ctx,
      await provider.getAllSourceFiles.call(provider),
    );
  }

  logger.debug("No remote source-list capability; scanning the project filesystem", {
    projectDir: ctx.projectDir,
  });
  return await collectCSSCandidateSourceFiles({
    projectDir: ctx.projectDir,
    patterns: ["**/*"],
    adapter: ctx.adapter,
    styleProfile: createStyleScopeProfile(ctx.config),
  });
}
