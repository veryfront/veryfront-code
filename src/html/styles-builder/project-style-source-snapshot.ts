import type { VeryfrontConfig } from "#veryfront/config";
import { isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { createSecureFs } from "#veryfront/security";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import { assertCSSFileContent } from "#veryfront/utils/css-content-admission.ts";
import {
  assertBoundedPathString,
  assertCanonicalProjectRelativePath,
} from "#veryfront/utils/project-relative-path.ts";
import { CSS_IMPORTING_SOURCE_EXTENSIONS } from "./css-import-extraction.ts";
import {
  createStyleScopeProfile,
  shouldIncludeStylePath,
  type StyleScopeProfile,
} from "./style-scope-profile.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const numberIsSafeInteger = Number.isSafeInteger;
const MAX_PROVIDER_PROTOTYPE_DEPTH = 64;
const MAX_CONTEXT_VALUE_CHARACTERS = 4_096;
const universalObjectPrototype = Object.prototype;
const admittedSourceFileSnapshots = new WeakSet<object>();
const admittedSuppliedSourceFileSnapshots = new WeakSet<object>();
const admittedProjectSnapshots = new WeakSet<object>();
const admittedContentContexts = new WeakSet<object>();

export interface ProjectStyleSourceFileSnapshot {
  readonly path: string;
  readonly content: string;
}

export interface ProjectStyleSourceSnapshot {
  readonly origin: "provider" | "local";
  readonly contentContext: Readonly<ResolvedContentContext> | null;
  readonly projectUpdatedAt?: string;
  /** Null means that the provider exposes metadata but no source-list capability. */
  readonly files: readonly ProjectStyleSourceFileSnapshot[] | null;
}

export interface SuppliedProjectStyleSourceFileSnapshot {
  readonly path: string;
  readonly content?: string;
}

export interface ProjectStyleSourceFileAdmissionOptions {
  /** Required when absolute paths are supplied or missing content must be read. */
  readonly projectDir?: string;
  /** Required only when missing content must be read from the project filesystem. */
  readonly adapter?: RuntimeAdapter;
  /** Optional configuration-derived scope used by provider and local collectors. */
  readonly config?: VeryfrontConfig;
  /** An already-created scope profile takes precedence over config. */
  readonly styleProfile?: StyleScopeProfile;
  /** Retain stylesheet entries in addition to candidate/import source modules. */
  readonly includeStylesheets?: boolean;
}

export interface CaptureProjectStyleSourceSnapshotOptions
  extends ProjectStyleSourceFileAdmissionOptions {
  readonly adapter: RuntimeAdapter;
  readonly projectDir: string;
  readonly config: VeryfrontConfig;
  /** Optional caller policy evaluated after context admission and before listing retrieval. */
  readonly validateContentContext?: (
    context: Readonly<ResolvedContentContext> | null,
  ) => void;
}

/** Return true only for an immutable source array created by this module. */
export function isProjectStyleSourceFileSnapshot(
  value: unknown,
): value is readonly ProjectStyleSourceFileSnapshot[] {
  return (typeof value === "object" && value !== null) &&
    admittedSourceFileSnapshots.has(value);
}

/** Return true only for an immutable supplied-file snapshot created here. */
export function isSuppliedProjectStyleSourceFileSnapshot(
  value: unknown,
): value is readonly SuppliedProjectStyleSourceFileSnapshot[] {
  return (typeof value === "object" && value !== null) &&
    admittedSuppliedSourceFileSnapshots.has(value);
}

/** Return true only for a detached project snapshot created by this module. */
export function isProjectStyleSourceSnapshot(
  value: unknown,
): value is ProjectStyleSourceSnapshot {
  return (typeof value === "object" && value !== null) && admittedProjectSnapshots.has(value);
}

function freezeSourceFileSnapshot(
  files: ProjectStyleSourceFileSnapshot[],
): readonly ProjectStyleSourceFileSnapshot[] {
  admittedSourceFileSnapshots.add(files);
  return freeze(files);
}

/** Construct a branded immutable root around an already-admitted file snapshot. */
export function createProjectStyleSourceSnapshot(
  origin: "provider" | "local",
  contentContext: Readonly<ResolvedContentContext> | null,
  files: readonly ProjectStyleSourceFileSnapshot[] | null,
  projectUpdatedAt?: string,
): ProjectStyleSourceSnapshot {
  if (contentContext !== null && !admittedContentContexts.has(contentContext)) {
    throw new TypeError("Project style content context must be an admitted snapshot");
  }
  if (files !== null && !isProjectStyleSourceFileSnapshot(files)) {
    throw new TypeError("Project style source files must be an admitted snapshot");
  }
  const admittedUpdatedAt = projectUpdatedAt === undefined
    ? undefined
    : assertBoundedContextValue(projectUpdatedAt, "CSS project updated_at");
  const snapshot = freeze(Object.assign(Object.create(null), {
    origin,
    contentContext,
    projectUpdatedAt: admittedUpdatedAt,
    files,
  })) as ProjectStyleSourceSnapshot;
  admittedProjectSnapshots.add(snapshot);
  return snapshot;
}

function captureOptionalMethod(
  value: object,
  key: string,
  label: string,
): ((...args: never[]) => unknown) | undefined {
  let owner: object | null = value;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < MAX_PROVIDER_PROTOTYPE_DEPTH; depth++) {
    if (owner === universalObjectPrototype) return undefined;
    if (isProxyWithoutHooks(owner)) {
      throw new TypeError(`${label} must not be a Proxy`);
    }
    if (seen.has(owner)) {
      throw new TypeError(`${label} has an invalid prototype chain`);
    }
    seen.add(owner);

    let parent: object | null;
    try {
      parent = getPrototypeOf(owner);
    } catch (cause) {
      throw new TypeError(`${label} could not be inspected safely`, { cause });
    }
    if (owner !== value && parent === null) return undefined;

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = getOwnPropertyDescriptor(owner, key);
    } catch (cause) {
      throw new TypeError(`${label} could not be inspected safely`, { cause });
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        throw new TypeError(`${label} ${key} must be a data-property function`);
      }
      if (descriptor.value === undefined) return undefined;
      if (typeof descriptor.value !== "function" || isProxyWithoutHooks(descriptor.value)) {
        throw new TypeError(`${label} ${key} must be a non-Proxy function`);
      }
      return descriptor.value as (...args: never[]) => unknown;
    }
    owner = parent;
  }
  if (owner !== null) throw new TypeError(`${label} prototype chain is too deep`);
  return undefined;
}

function readOwnDataProperty(
  value: object,
  key: PropertyKey,
  label: string,
  required = true,
): unknown {
  if (isProxyWithoutHooks(value)) throw new TypeError(`${label} must not be a Proxy`);
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected safely`, { cause });
  }
  if (descriptor === undefined) {
    if (required) {
      throw new TypeError(`${label} must define ${String(key)} using data properties`);
    }
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`${label} must define ${String(key)} using data properties`);
  }
  return descriptor.value;
}

function assertBoundedContextValue(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CONTEXT_VALUE_CHARACTERS
  ) {
    throw new TypeError(
      `${label} must be a non-empty string of at most ${MAX_CONTEXT_VALUE_CHARACTERS} characters`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      throw new TypeError(`${label} must not contain control characters`);
    }
  }
  return value;
}

/** Snapshot a provider-owned content context without invoking accessors or Proxy traps. */
export function snapshotResolvedStyleContentContext(
  value: unknown,
): Readonly<ResolvedContentContext> | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "object" ||
    arrayIsArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    throw new TypeError("CSS content context must be a non-Proxy object or null");
  }

  const sourceType = readOwnDataProperty(value, "sourceType", "CSS content context");
  if (sourceType !== "branch" && sourceType !== "environment" && sourceType !== "release") {
    throw new TypeError("CSS content context has an invalid sourceType");
  }
  const projectSlug = assertBoundedContextValue(
    readOwnDataProperty(value, "projectSlug", "CSS content context"),
    "CSS content context projectSlug",
  );
  const snapshot = Object.assign(Object.create(null), {
    sourceType,
    projectSlug,
    branch: undefined,
    environmentName: undefined,
    releaseId: undefined,
  }) as ResolvedContentContext;
  const selectorKeys = sourceType === "branch"
    ? ["branch"] as const
    : sourceType === "environment"
    ? ["environmentName", "releaseId"] as const
    : ["releaseId"] as const;
  for (const key of selectorKeys) {
    const selector = readOwnDataProperty(value, key, "CSS content context", false);
    if (selector !== undefined) {
      snapshot[key] = assertBoundedContextValue(
        selector,
        `CSS content context ${key}`,
      );
    }
  }
  const frozenSnapshot = freeze(snapshot);
  admittedContentContexts.add(frozenSnapshot);
  return frozenSnapshot;
}

function snapshotProjectUpdatedAt(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || arrayIsArray(value) || isProxyWithoutHooks(value)) {
    throw new TypeError("CSS project data must be a non-Proxy object when present");
  }
  const updatedAt = readOwnDataProperty(value, "updated_at", "CSS project data", false);
  return updatedAt === undefined
    ? undefined
    : assertBoundedContextValue(updatedAt, "CSS project updated_at");
}

function snapshotDenseListing(value: unknown): unknown[] {
  if (isProxyWithoutHooks(value)) throw new TypeError("CSS source listing must not be a Proxy");
  if (!arrayIsArray(value)) throw new TypeError("CSS source listing must be an array");

  let lengthDescriptor: PropertyDescriptor | undefined;
  let keys: PropertyKey[];
  try {
    lengthDescriptor = getOwnPropertyDescriptor(value, "length");
    keys = ownKeys(value);
  } catch (cause) {
    throw new TypeError("CSS source listing could not be inspected safely", { cause });
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!numberIsSafeInteger(length) || length < 0 || length > MAX_CSS_FILES) {
    throw new TypeError(`CSS source listing exceeds ${MAX_CSS_FILES} entries`);
  }
  if (keys.length !== length + 1) {
    throw new TypeError("CSS source listing must be a dense data-property array");
  }

  const snapshot = new Array<unknown>(length);
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw new TypeError("CSS source listing must be a dense data-property array");
    }
    const index = Number(key);
    if (!numberIsSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new TypeError("CSS source listing must be a dense data-property array");
    }
  }
  for (let index = 0; index < length; index++) {
    const descriptor = getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError("CSS source listing must be a dense data-property array");
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}

function resolveProjectRoot(projectDir: string | undefined): string | undefined {
  if (projectDir === undefined) return undefined;
  const admittedProjectDir = assertBoundedPathString(
    projectDir,
    "CSS source project directory",
  );
  if (!isAbsolute(admittedProjectDir)) {
    throw new TypeError("CSS source project directory must be absolute");
  }
  return resolve(admittedProjectDir);
}

function resolveSourcePath(value: unknown, projectRoot: string | undefined): string {
  const admittedPath = assertBoundedPathString(value, "CSS source path");
  if (!isAbsolute(admittedPath)) {
    const relativePath = assertCanonicalProjectRelativePath(admittedPath, "CSS source path");
    return projectRoot === undefined ? relativePath : resolve(projectRoot, relativePath);
  }

  if (projectRoot === undefined) {
    throw new TypeError("Absolute CSS source paths require an absolute project directory");
  }

  const absolutePath = resolve(admittedPath);
  const relativePath = relative(projectRoot, absolutePath).replaceAll("\\", "/");
  const canonicalRelative = assertCanonicalProjectRelativePath(relativePath, "CSS source path");
  if (resolve(projectRoot, canonicalRelative) !== absolutePath) {
    throw new TypeError("CSS source path must resolve within the project");
  }
  return absolutePath;
}

function shouldRetainPath(path: string, includeStylesheets: boolean): boolean {
  const lowercasePath = path.toLowerCase();
  return CSS_IMPORTING_SOURCE_EXTENSIONS.some((extension) => lowercasePath.endsWith(extension)) ||
    (includeStylesheets && lowercasePath.endsWith(".css"));
}

/**
 * Detach caller-supplied source metadata without invoking its iterator or
 * entry accessors. Missing content remains missing for the exact-read phase.
 */
export function snapshotSuppliedProjectStyleSourceFiles(
  listing: unknown,
  options: ProjectStyleSourceFileAdmissionOptions,
): readonly SuppliedProjectStyleSourceFileSnapshot[] {
  if (
    isProjectStyleSourceFileSnapshot(listing) ||
    isSuppliedProjectStyleSourceFileSnapshot(listing)
  ) {
    return listing;
  }
  const entries = snapshotDenseListing(listing);
  const projectRoot = resolveProjectRoot(options.projectDir);
  const styleProfile = options.styleProfile ??
    (options.config === undefined ? undefined : createStyleScopeProfile(options.config));
  const files: SuppliedProjectStyleSourceFileSnapshot[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;

  for (const candidate of entries) {
    if (isProxyWithoutHooks(candidate)) {
      throw new TypeError("CSS source entries must not be a Proxy");
    }
    if (typeof candidate !== "object" || candidate === null || arrayIsArray(candidate)) {
      throw new TypeError("CSS source entries must be non-Proxy objects with data properties");
    }
    const path = resolveSourcePath(
      readOwnDataProperty(candidate, "path", "CSS source entry"),
      projectRoot,
    );
    if (seenPaths.has(path)) {
      throw new TypeError(`CSS source listing contains a duplicate path: ${path}`);
    }
    seenPaths.add(path);

    if (
      !shouldRetainPath(path, options.includeStylesheets === true) ||
      (styleProfile !== undefined && !shouldIncludeStylePath(styleProfile, path, projectRoot))
    ) {
      continue;
    }

    const suppliedContent = readOwnDataProperty(
      candidate,
      "content",
      "CSS source entry",
      false,
    );
    if (suppliedContent !== undefined && typeof suppliedContent !== "string") {
      throw new TypeError("CSS source entry content must be a string when present");
    }
    if (typeof suppliedContent === "string") {
      const byteLength = assertCSSFileContent(suppliedContent, `CSS source file ${path}`);
      if (byteLength > MAX_CSS_TOTAL_BYTES - totalBytes) {
        throw new TypeError(`CSS source content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`);
      }
      totalBytes += byteLength;
    }
    files.push(freeze(Object.assign(Object.create(null), {
      path,
      content: suppliedContent,
    })) as SuppliedProjectStyleSourceFileSnapshot);
  }

  files.sort((left, right) => left.path === right.path ? 0 : left.path < right.path ? -1 : 1);
  admittedSuppliedSourceFileSnapshots.add(files);
  return freeze(files);
}

/** Admit and freeze one source listing, exactly reading any missing content. */
export async function snapshotProjectStyleSourceFiles(
  listing: unknown,
  options: ProjectStyleSourceFileAdmissionOptions,
): Promise<readonly ProjectStyleSourceFileSnapshot[]> {
  if (isProjectStyleSourceFileSnapshot(listing)) return listing;
  const suppliedFiles = snapshotSuppliedProjectStyleSourceFiles(listing, options);
  const projectRoot = resolveProjectRoot(options.projectDir);
  const files: ProjectStyleSourceFileSnapshot[] = [];
  let totalBytes = 0;
  let sourceReader: ReturnType<typeof captureBoundedTextReader> | undefined;

  for (const suppliedFile of suppliedFiles) {
    const remainingBytes = MAX_CSS_TOTAL_BYTES - totalBytes;
    let content = suppliedFile.content;
    let byteLength: number;
    if (content === undefined) {
      if (projectRoot === undefined || options.adapter === undefined) {
        throw new TypeError(
          "CSS source entries without content require a project directory and runtime adapter",
        );
      }
      sourceReader ??= captureBoundedTextReader(
        createSecureFs({
          baseDir: projectRoot,
          adapter: options.adapter,
          context: "build",
          validationOptions: { followSymlinks: false },
        }),
        "CSS source filesystem",
      );
      const source = await sourceReader.readUtf8(
        suppliedFile.path,
        Math.max(1, Math.min(MAX_CSS_FILE_BYTES, remainingBytes)),
        `CSS source file ${suppliedFile.path}`,
      );
      content = source.content;
      byteLength = source.byteLength;
      if (byteLength > remainingBytes) {
        throw new TypeError(`CSS source content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`);
      }
    } else {
      byteLength = assertCSSFileContent(content, `CSS source file ${suppliedFile.path}`);
      if (byteLength > remainingBytes) {
        throw new TypeError(`CSS source content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`);
      }
    }
    totalBytes += byteLength;
    files.push(freeze(Object.assign(Object.create(null), {
      path: suppliedFile.path,
      content,
    })) as ProjectStyleSourceFileSnapshot);
  }

  return freezeSourceFileSnapshot(files);
}

/** Reuse a branded file snapshot or admit an untrusted caller-owned listing. */
export async function admitProjectStyleSourceFiles(
  value: unknown,
  options: ProjectStyleSourceFileAdmissionOptions,
): Promise<readonly ProjectStyleSourceFileSnapshot[]> {
  return isProjectStyleSourceFileSnapshot(value)
    ? value
    : await snapshotProjectStyleSourceFiles(value, options);
}

/**
 * Capture one provider, its context/project metadata, and its optional source
 * listing into a detached immutable snapshot. Every extension capability is
 * descriptor-admitted and invoked at most once.
 */
export async function captureProjectStyleSourceSnapshot(
  options: CaptureProjectStyleSourceSnapshotOptions,
): Promise<ProjectStyleSourceSnapshot | null> {
  const wrappedFs = options.adapter.fs;
  const getUnderlyingAdapter = captureOptionalMethod(
    wrappedFs,
    "getUnderlyingAdapter",
    "CSS source filesystem wrapper",
  );
  if (getUnderlyingAdapter === undefined) return null;

  const provider = apply(getUnderlyingAdapter, wrappedFs, []);
  if (
    typeof provider !== "object" ||
    provider === null ||
    arrayIsArray(provider) ||
    isProxyWithoutHooks(provider)
  ) {
    throw new TypeError("CSS source provider must be a non-Proxy object");
  }
  const getContentContext = captureOptionalMethod(
    provider,
    "getContentContext",
    "CSS source provider",
  );
  const getProjectData = captureOptionalMethod(
    provider,
    "getProjectData",
    "CSS source provider",
  );
  const getAllSourceFiles = captureOptionalMethod(
    provider,
    "getAllSourceFiles",
    "CSS source provider",
  );

  const contentContext = getContentContext === undefined
    ? null
    : snapshotResolvedStyleContentContext(await apply(getContentContext, provider, []));
  options.validateContentContext?.(contentContext);
  const projectUpdatedAt = getProjectData === undefined
    ? undefined
    : snapshotProjectUpdatedAt(await apply(getProjectData, provider, []));
  const files = getAllSourceFiles === undefined ? null : await snapshotProjectStyleSourceFiles(
    await apply(getAllSourceFiles, provider, []),
    options,
  );

  return createProjectStyleSourceSnapshot(
    "provider",
    contentContext,
    files,
    projectUpdatedAt,
  );
}
