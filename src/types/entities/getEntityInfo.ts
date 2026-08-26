/** Bounded page and layout entity discovery. @module types/entities/getEntityInfo */

import { extract } from "#std/front-matter/yaml.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import * as pathHelper from "#veryfront/compat/path";
import { detectEntityType, normalizeFrontmatter } from "../entities.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/index.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { MAX_PATH_LENGTH_CHARS, MAX_ROUTE_SEGMENTS } from "#veryfront/utils/constants/limits.ts";
import {
  captureBoundedTextReader,
  type CapturedBoundedTextReader,
} from "#veryfront/platform/adapters/bounded-text-reader.ts";
import {
  type CapturedSnapshotReader,
  captureSnapshotReadCapability,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { isFileSnapshotPathError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import {
  isNativeErrorWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import {
  containsPathControlCharacters,
  parseRouteParameterSegment,
} from "#veryfront/utils/route-path-utils.ts";
import {
  DYNAMIC_ROUTE_ERROR,
  INVALID_ROUTE_FILE,
  ROUTE_CONFLICT,
} from "#veryfront/errors/error-registry/route.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const logger = baseLogger.component("get-entity-by-slug");

const fs = createFileSystem();
const MAX_ENTITY_SOURCE_BYTES = DEFAULT_MAX_FILE_SIZE_BYTES;
const MAX_DIRECTORY_ENTRIES = 2_048;
const MAX_DYNAMIC_DIRECTORIES = 256;
const MAX_DYNAMIC_ENTRIES = 8_192;
const MAX_MATCHING_ROUTE_CANDIDATES = 32;
const MAX_PROTOTYPE_DEPTH = 64;
const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });
const DEFAULT_ENTITY_RESOLUTION_TIMEOUT_MS = 30_000;
const MAX_ACTIVE_PROJECT_RESOLUTIONS = 4;
const MAX_QUEUED_PROJECT_RESOLUTIONS = 16;
const MAX_ACTIVE_GLOBAL_RESOLUTIONS = 16;
const MAX_QUEUED_GLOBAL_RESOLUTIONS = 64;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const dateNow = Date.now;
const setTimer = setTimeout;
const clearTimer = clearTimeout;
const PAGE_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const DIRECT_ROUTE_EXTENSIONS = PAGE_FILE_EXTENSIONS;
const LAYOUT_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const SUPPORTED_PAGE_EXTENSION_PATTERN = /\.(mdx|md|tsx|jsx|ts|js)$/i;
const SUPPORTED_PAGE_SUFFIX_PATTERN = /^\.(mdx|md|tsx|jsx|ts|js)$/i;

/** @internal Immutable directory-entry snapshot used during route discovery. */
export interface EntityResolutionDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}
type DirectoryEntry = EntityResolutionDirectoryEntry;
type EntityCandidate = { path: string; root: string; virtualRoot: string };
type DynamicTraversalBudget = { directoriesVisited: number; entriesInspected: number };

export interface EntityResolutionOptions {
  /** Caller cancellation for this one page or layout lookup. */
  readonly signal?: AbortSignal;
  /** Absolute Unix timestamp in milliseconds for this lookup. */
  readonly deadline?: number;
  /** Stable tenant/project identity used only for resolution admission isolation. */
  readonly scopeKey?: string;
}

export interface EntityInfoOptions extends EntityResolutionOptions {
  /** Explicit directory from which an index page slug is derived. */
  readonly routeRoot?: string;
}

interface CapturedMethod<Args extends readonly unknown[], Result> {
  invoke(...args: Args): Result;
}

interface CapturedEntityReadAuthority {
  readonly bounded: CapturedBoundedTextReader;
  readonly snapshot?: CapturedSnapshotReader;
  readonly symlinkFree: boolean;
  readonly readDir?: CapturedMethod<[string], AsyncIterable<unknown>>;
  readonly resolveFile?: CapturedMethod<[string], Promise<string | null>>;
  readonly resolveEntityId?: CapturedMethod<[string], unknown>;
}

/** @internal Cancellation-aware operations shared by framework entity resolvers. */
export interface EntityResolutionGate {
  throwIfCancelled(): void;
  awaitOperation<T>(operation: () => Promise<T>): Promise<T>;
}

/** @internal Captured route-filesystem operations for one admitted lookup. */
export interface EntityResolutionSession extends EntityResolutionGate {
  readonly hasResolveFile: boolean;
  resolveFile(path: string): Promise<string | null>;
  readDirectory(path: string): Promise<readonly EntityResolutionDirectoryEntry[]>;
  readEntityWithinRoot(
    filePath: string,
    rootDir: string,
    virtualRoot?: string,
  ): Promise<EntityInfo | null>;
}

interface ResolutionLifecycle extends EntityResolutionGate {
  readonly signal?: AbortSignal;
  readonly deadline: number;
  waitForPendingOperations(): Promise<void>;
}

interface ResolutionContext extends ResolutionLifecycle {
  readonly authority: CapturedEntityReadAuthority;
}

interface ProjectLaneRegistration {
  readonly lane: ResolutionLane;
  cleanup(): void;
}

interface LaneWaiter {
  readonly context: ResolutionLifecycle;
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;
  abortListener?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

class ResolutionLane {
  #active = 0;
  readonly #waiters: LaneWaiter[] = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueued: number,
    private readonly queueLabel: string,
  ) {}

  get idle(): boolean {
    return this.#active === 0 && this.#waiters.length === 0;
  }

  async acquire(context: ResolutionLifecycle): Promise<() => void> {
    context.throwIfCancelled();
    if (this.#active < this.maxActive) {
      this.#active++;
      return createOnceRelease(() => this.#release());
    }
    if (this.#waiters.length >= this.maxQueued) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: `${this.queueLabel} exceeds the ${this.maxQueued}-request limit`,
      });
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: LaneWaiter = { context, resolve, reject };
      const removeAndReject = (reason: unknown): void => {
        const index = this.#waiters.indexOf(waiter);
        if (index === -1) return;
        this.#waiters.splice(index, 1);
        cleanupLaneWaiter(waiter);
        reject(reason);
      };

      const armDeadline = (): void => {
        const remainingMs = context.deadline - dateNow();
        if (remainingMs <= 0) {
          removeAndReject(createResolutionTimeoutError());
          return;
        }
        waiter.timer = setTimer(
          armDeadline,
          Math.min(remainingMs, MAX_TIMER_DELAY_MS),
        );
      };
      if (context.signal) {
        waiter.abortListener = () => removeAndReject(getAbortReason(context.signal!));
        context.signal.addEventListener("abort", waiter.abortListener, { once: true });
      }
      this.#waiters.push(waiter);
      if (context.signal?.aborted) {
        removeAndReject(getAbortReason(context.signal));
      } else {
        armDeadline();
      }
    });

    try {
      context.throwIfCancelled();
    } catch (error) {
      this.#release();
      throw error;
    }
    return createOnceRelease(() => this.#release());
  }

  #release(): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      cleanupLaneWaiter(waiter);
      waiter.resolve();
      return;
    }
    this.#active--;
  }
}

class ResolutionCapacity {
  #admitted = 0;

  acquire(context: ResolutionLifecycle): () => void {
    context.throwIfCancelled();
    const maxAdmitted = MAX_ACTIVE_GLOBAL_RESOLUTIONS + MAX_QUEUED_GLOBAL_RESOLUTIONS;
    if (this.#admitted >= maxAdmitted) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail:
          `Global route resolution capacity exceeds the ${MAX_ACTIVE_GLOBAL_RESOLUTIONS}-active/${MAX_QUEUED_GLOBAL_RESOLUTIONS}-queued limit`,
      });
    }
    this.#admitted++;
    return createOnceRelease(() => {
      this.#admitted--;
    });
  }
}

const localProjectLanes = new Map<string, ResolutionLane>();
const adapterProjectLanes = new WeakMap<object, Map<string, ResolutionLane>>();
const globalResolutionLane = new ResolutionLane(
  MAX_ACTIVE_GLOBAL_RESOLUTIONS,
  MAX_QUEUED_GLOBAL_RESOLUTIONS,
  "Global route resolution queue",
);
const globalResolutionCapacity = new ResolutionCapacity();

function isFileNotFoundError(error: unknown): boolean {
  return isCanonicalNotFoundError(error);
}

/**
 * Classify the native error produced when the captured local filesystem reads
 * a directory as a file. This intentionally applies only to the framework's
 * own local filesystem: adapter errors remain operational failures and are
 * never converted to ordinary absence based on an error-shaped value.
 */
function isLocalDirectoryReadError(
  error: unknown,
  adapter: RuntimeAdapter | undefined,
): boolean {
  if (adapter !== undefined || !isNativeErrorWithoutHooks(error)) return false;
  if (readNativeErrorNameWithoutHooks(error) === "IsADirectory") return true;

  try {
    const code = Reflect.getOwnPropertyDescriptor(error, "code");
    return code !== undefined && "value" in code && code.value === "EISDIR";
  } catch {
    return false;
  }
}

function createOnceRelease(release: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

function cleanupLaneWaiter(waiter: LaneWaiter): void {
  if (waiter.timer !== undefined) clearTimer(waiter.timer);
  if (waiter.abortListener && waiter.context.signal) {
    waiter.context.signal.removeEventListener("abort", waiter.abortListener);
  }
}

function createResolutionTimeoutError(): Error {
  return new DOMException("Entity resolution exceeded its deadline", "TimeoutError");
}

function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Entity resolution was aborted", "AbortError");
}

function createResolutionLifecycle(
  options: EntityResolutionOptions = {},
): ResolutionLifecycle {
  const requestedDeadline = options.deadline;
  if (
    requestedDeadline !== undefined &&
    (!Number.isFinite(requestedDeadline) || requestedDeadline < 0)
  ) {
    throw new TypeError("Entity resolution deadline must be a finite non-negative timestamp");
  }

  const signal = options.signal;
  const deadline = requestedDeadline ?? dateNow() + DEFAULT_ENTITY_RESOLUTION_TIMEOUT_MS;
  const pendingOperations = new Set<Promise<unknown>>();
  const throwIfCancelled = (): void => {
    if (signal?.aborted) throw getAbortReason(signal);
    if (dateNow() >= deadline) throw createResolutionTimeoutError();
  };

  const trackOperation = <T>(operation: Promise<T>): Promise<T> => {
    pendingOperations.add(operation);
    void operation.then(
      () => pendingOperations.delete(operation),
      () => pendingOperations.delete(operation),
    );
    return operation;
  };

  const awaitOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
    throwIfCancelled();
    const activeOperation = trackOperation(Promise.resolve().then(operation));

    let abortListener: (() => void) | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      const rejectIfCancelled = (): boolean => {
        if (signal?.aborted) {
          reject(getAbortReason(signal));
          return true;
        }
        const remainingMs = deadline - dateNow();
        if (remainingMs <= 0) {
          reject(createResolutionTimeoutError());
          return true;
        }
        deadlineTimer = setTimer(
          rejectIfCancelled,
          Math.min(remainingMs, MAX_TIMER_DELAY_MS),
        );
        return false;
      };

      if (signal) {
        abortListener = () => reject(getAbortReason(signal));
        signal.addEventListener("abort", abortListener, { once: true });
      }
      if (rejectIfCancelled() && abortListener && signal) {
        signal.removeEventListener("abort", abortListener);
        abortListener = undefined;
      }
    });

    try {
      const result = await Promise.race([activeOperation, cancellation]);
      throwIfCancelled();
      return result;
    } finally {
      if (deadlineTimer !== undefined) clearTimer(deadlineTimer);
      if (abortListener && signal) {
        signal.removeEventListener("abort", abortListener);
      }
    }
  };

  return Object.freeze({
    signal,
    deadline,
    throwIfCancelled,
    awaitOperation,
    async waitForPendingOperations(): Promise<void> {
      while (pendingOperations.size > 0) {
        await Promise.allSettled([...pendingOperations]);
      }
    },
  });
}

function createResolutionContext(
  adapter: RuntimeAdapter | undefined,
  options: EntityResolutionOptions = {},
): ResolutionContext {
  const lifecycle = createResolutionLifecycle(options);
  return Object.freeze({
    ...lifecycle,
    authority: captureEntityReadAuthority(adapter),
  });
}

function captureEntityReadAuthority(
  adapter: RuntimeAdapter | undefined,
): CapturedEntityReadAuthority {
  const fileSystem = adapter?.fs ?? fs;
  const bounded = captureBoundedTextReader(fileSystem, "Route filesystem");
  const snapshot = captureSnapshotReadCapability(
    fileSystem,
    "Route filesystem",
    true,
  );
  const symlinkFree = adapter !== undefined && hasNoSymlinkSemantics(fileSystem);
  const readDir = captureDataMethod<[string], AsyncIterable<unknown>>(
    fileSystem,
    "readDir",
  );
  const resolveFile = adapter
    ? captureDataMethod<[string], Promise<string | null>>(fileSystem, "resolveFile")
    : undefined;
  const resolveEntityId = adapter ? captureEntityIdResolver(adapter) : undefined;

  return Object.freeze({
    bounded,
    snapshot,
    symlinkFree,
    readDir,
    resolveFile,
    resolveEntityId,
  });
}

function captureEntityIdResolver(
  adapter: RuntimeAdapter,
): CapturedMethod<[string], unknown> | undefined {
  const isVeryfrontAdapter = captureDataMethod<[], unknown>(
    adapter.fs,
    "isVeryfrontAdapter",
  );
  const getUnderlyingAdapter = captureDataMethod<[], unknown>(
    adapter.fs,
    "getUnderlyingAdapter",
  );
  if (
    !isVeryfrontAdapter || !getUnderlyingAdapter ||
    isVeryfrontAdapter.invoke() !== true
  ) return undefined;

  const underlyingAdapter = getUnderlyingAdapter.invoke();
  return captureDataMethod<[string], unknown>(
    underlyingAdapter,
    "getEntityIdForPath",
  );
}

function captureDataMethod<Args extends readonly unknown[], Result>(
  value: unknown,
  key: string,
): CapturedMethod<Args, Result> | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const receiver = value as object;
  const visited = new Set<object>();
  let current: object | null = receiver;
  for (let depth = 0; current && depth < MAX_PROTOTYPE_DEPTH; depth++) {
    if (current === Object.prototype) return undefined;
    if (visited.has(current)) {
      throw INVALID_ROUTE_FILE.create({
        detail: `Adapter ${key} has a cyclic prototype chain`,
      });
    }
    visited.add(current);

    const parent = Reflect.getPrototypeOf(current);
    // A foreign realm's Object.prototype is terminal and never authority.
    if (current !== receiver && parent === null) return undefined;

    const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor) || descriptor.value === undefined) return undefined;
      if (typeof descriptor.value !== "function") {
        throw INVALID_ROUTE_FILE.create({
          detail: `Adapter ${key} must be a data-property method`,
        });
      }
      const method = descriptor.value as (...args: Args) => Result;
      return Object.freeze({
        invoke: (...args: Args): Result => Reflect.apply(method, receiver, args),
      });
    }
    current = parent;
  }
  if (current !== null) {
    throw INVALID_ROUTE_FILE.create({
      detail: `Adapter ${key} prototype chain is too deep`,
    });
  }
  return undefined;
}

async function awaitResolution<T>(
  context: ResolutionContext,
  operation: () => Promise<T>,
): Promise<T> {
  return await context.awaitOperation(operation);
}

function getProjectLaneRegistration(
  projectScope: string,
  adapter: RuntimeAdapter | undefined,
): ProjectLaneRegistration {
  const projectKey = projectScope;
  let lanes: Map<string, ResolutionLane>;
  if (adapter) {
    const authorityKey = adapter.fs as object;
    lanes = adapterProjectLanes.get(authorityKey) ?? new Map();
    if (!adapterProjectLanes.has(authorityKey)) {
      adapterProjectLanes.set(authorityKey, lanes);
    }
  } else {
    lanes = localProjectLanes;
  }

  const lane = lanes.get(projectKey) ?? new ResolutionLane(
    MAX_ACTIVE_PROJECT_RESOLUTIONS,
    MAX_QUEUED_PROJECT_RESOLUTIONS,
    "Project route resolution queue",
  );
  if (!lanes.has(projectKey)) lanes.set(projectKey, lane);
  return {
    lane,
    cleanup(): void {
      if (lane.idle && lanes.get(projectKey) === lane) lanes.delete(projectKey);
    },
  };
}

async function withProjectResolutionAdmission<T>(
  projectScope: string,
  adapter: RuntimeAdapter | undefined,
  context: ResolutionLifecycle,
  operation: () => Promise<T>,
): Promise<T> {
  const registration = getProjectLaneRegistration(projectScope, adapter);
  let releaseCapacity: (() => void) | undefined;
  let releaseProject: (() => void) | undefined;
  let releaseGlobal: (() => void) | undefined;
  try {
    // Reserve bounded isolate capacity before entering a project lane. The
    // project lane still comes before the global active lane, so one noisy
    // tenant cannot occupy global execution permits while waiting on itself.
    releaseCapacity = globalResolutionCapacity.acquire(context);
    releaseProject = await registration.lane.acquire(context);
    releaseGlobal = await globalResolutionLane.acquire(context);
  } catch (error) {
    releaseProject?.();
    releaseCapacity?.();
    registration.cleanup();
    throw error;
  }

  const result = Promise.resolve().then(operation);
  const releaseAfterUnderlyingWork = async (): Promise<void> => {
    // A caller receives its deadline or abort immediately. The permits remain
    // held until any adapter promise that cannot be cancelled has actually
    // settled, so reported cancellation never creates hidden overcommit.
    await context.waitForPendingOperations();
    releaseGlobal?.();
    releaseProject?.();
    releaseCapacity?.();
    registration.cleanup();
  };
  void result.then(releaseAfterUnderlyingWork, releaseAfterUnderlyingWork);
  return await result;
}

function getResolutionScope(
  projectDir: string,
  options: EntityResolutionOptions,
): string {
  const scopeKey = options.scopeKey ?? projectDir;
  if (!isBoundedIdentifier(scopeKey)) {
    throw new TypeError("Entity resolution scope key must be a bounded non-empty string");
  }
  return options.scopeKey === undefined
    ? `path:${normalizeComparablePath(scopeKey)}`
    : `scope:${scopeKey}`;
}

/**
 * Run an internal resolver under the same tenant and isolate-wide admission
 * boundary used by Pages Router entity discovery.
 * @internal
 */
export async function withEntityResolutionAdmission<T>(
  projectDir: string,
  adapter: RuntimeAdapter,
  options: EntityResolutionOptions,
  operation: (session: EntityResolutionSession) => Promise<T>,
): Promise<T> {
  const context = createResolutionContext(adapter, options);
  const resolveFile = context.authority.resolveFile;
  const session: EntityResolutionSession = Object.freeze({
    throwIfCancelled: context.throwIfCancelled,
    awaitOperation: context.awaitOperation,
    hasResolveFile: resolveFile !== undefined,
    async resolveFile(path: string): Promise<string | null> {
      if (!resolveFile) return null;
      const resolvedPath = await awaitResolution(
        context,
        () => resolveFile.invoke(path),
      );
      if (resolvedPath === null) return null;
      if (typeof resolvedPath !== "string" || !isBoundedPath(resolvedPath)) {
        throw DYNAMIC_ROUTE_ERROR.create({
          detail: "Route adapter returned an invalid resolved path",
        });
      }
      return resolvedPath;
    },
    readDirectory(path: string): Promise<readonly DirectoryEntry[]> {
      return readDirectoryEntries(path, context);
    },
    readEntityWithinRoot(
      filePath: string,
      rootDir: string,
      virtualRoot = "",
    ): Promise<EntityInfo | null> {
      return getEntityInfoWithinRoot(
        filePath,
        rootDir,
        adapter,
        virtualRoot,
        context,
      );
    },
  });
  return await withProjectResolutionAdmission(
    getResolutionScope(projectDir, options),
    adapter,
    context,
    () => operation(session),
  );
}

/**
 * Reads and classifies one entity source file.
 *
 * Returns `null` when the source path does not identify a file. Adapter failures
 * other than a missing path are propagated to the caller.
 */
export async function getEntityInfo(
  filePath: string,
  adapter?: RuntimeAdapter,
  options: EntityInfoOptions = {},
): Promise<EntityInfo | null> {
  if (!isBoundedPath(filePath)) return null;
  if (options.routeRoot !== undefined && !isBoundedPath(options.routeRoot)) return null;
  const context = createResolutionContext(adapter, options);
  return await withSpan(
    "types.getEntityInfo",
    async () => {
      let source: { content: string; byteLength: number };
      try {
        source = await awaitResolution(
          context,
          () =>
            context.authority.bounded.readUtf8(
              filePath,
              MAX_ENTITY_SOURCE_BYTES,
              "Entity source",
            ),
        );
      } catch (error) {
        if (
          isFileNotFoundError(error) ||
          isLocalDirectoryReadError(error, adapter)
        ) return null;
        throw error;
      }
      return createEntityInfo(
        filePath,
        source.content,
        context.authority,
        options.routeRoot,
      );
    },
    { "entity.extension": pathHelper.extname(filePath).toLowerCase() },
  );
}

function createEntityInfo(
  filePath: string,
  content: string,
  authority: CapturedEntityReadAuthority,
  routeRoot?: string,
): EntityInfo {
  const ext = pathHelper.extname(filePath).toLowerCase();

  let frontmatter: Frontmatter = {};
  let body = content;
  if (ext === ".md" || ext === ".mdx") {
    try {
      const extracted = extract(content);
      frontmatter = normalizeFrontmatter(extracted.attrs);
      body = extracted.body;
    } catch {
      /* expected: malformed YAML frontmatter */
    }
  }

  const fileName = splitPathSegments(filePath).at(-1) ?? "";
  const { type, kind, isLayout, isComponent, isPage } = detectEntityType(
    fileName,
    frontmatter,
  );

  let entityId = filePath;
  const resolvedEntityId = authority.resolveEntityId?.invoke(filePath);
  if (resolvedEntityId !== undefined) {
    if (!isBoundedIdentifier(resolvedEntityId)) {
      throw INVALID_ROUTE_FILE.create({
        detail: "Entity identifier is invalid",
      });
    }
    entityId = resolvedEntityId;
  }

  const entity: Entity = {
    id: entityId,
    path: filePath,
    slug: getSlugFromPath(filePath, routeRoot),
    type,
    content: body,
    frontmatter,
    kind,
    isLayout,
    isComponent,
    isPage,
  };
  return { entity };
}

/**
 * Resolves a page entity for a project-relative route slug.
 *
 * Resolution checks exact page files, directory index files, and dynamic route
 * files without allowing candidates to escape the project root.
 */
export async function getEntityBySlug(
  projectDir: string,
  slug: string,
  adapter?: RuntimeAdapter,
  pagesDirectory = "pages",
  options: EntityResolutionOptions = {},
): Promise<EntityInfo | null> {
  if (
    !isBoundedPath(projectDir) ||
    !isBoundedPath(slug) ||
    !isBoundedPath(pagesDirectory)
  ) return null;

  const normalizedSlug = normalizeSlug(slug);
  const routeSegmentCount = countPathSegments(normalizedSlug);
  if (
    !isSafeRouteSlug(normalizedSlug) ||
    !isSafeProjectRelativePath(pagesDirectory) ||
    routeSegmentCount > MAX_ROUTE_SEGMENTS
  ) return null;

  const context = createResolutionContext(adapter, options);
  return await withProjectResolutionAdmission(
    getResolutionScope(projectDir, options),
    adapter,
    context,
    () =>
      withSpan(
        "types.getEntityBySlug",
        async () => {
          context.throwIfCancelled();
          const isVeryfrontRoute = normalizedSlug.startsWith(".veryfront/") ||
            normalizedSlug === ".veryfront";
          const resolveFile = context.authority.resolveFile;
          const pagesRoot = pathHelper.join(projectDir, pagesDirectory);
          const pageStems = buildPageStems(normalizedSlug);

          logger.debug("Resolving page entity", {
            routeSegmentCount,
            isVeryfrontRoute,
            hasResolveFile: !!resolveFile,
          });

          if (resolveFile) {
            const basePaths: EntityCandidate[] = pageStems.map((stem) => ({
              path: pathHelper.join(pagesRoot, stem),
              root: projectDir,
              virtualRoot: pagesDirectory,
            }));
            let directCandidateCount = 0;

            if (isVeryfrontRoute) {
              basePaths.unshift({
                path: pathHelper.join(projectDir, normalizedSlug),
                root: projectDir,
                virtualRoot: ".veryfront",
              });
              directCandidateCount = 1;
            }
            logger.debug("Resolving adapter page candidates", {
              candidateCount: basePaths.length,
            });

            const candidateGroups: EntityInfo[][] = [];
            for (const candidate of basePaths) {
              context.throwIfCancelled();
              candidateGroups.push(
                isBoundedPath(candidate.path)
                  ? await resolveAdapterPageCandidate(candidate, adapter, context)
                  : [],
              );
            }

            if (directCandidateCount > 0) {
              const directPage = selectPage(
                candidateGroups.slice(0, directCandidateCount).flat().filter(isPageEntityInfo),
                routeSegmentCount,
                "exact",
              );
              if (directPage) return withResolvedSlug(directPage, normalizedSlug);
            }
            const exactPage = selectPage(
              candidateGroups.slice(directCandidateCount).flat().filter(isPageEntityInfo),
              routeSegmentCount,
              "exact",
            );
            if (exactPage) {
              logger.debug("Resolved page entity", {
                routeSegmentCount,
              });
              return withResolvedSlug(exactPage, normalizedSlug);
            }

            const dynamicPage = await findDynamicPageEntity(
              projectDir,
              normalizedSlug,
              adapter,
              pagesDirectory,
              context,
            );
            if (dynamicPage) return withResolvedSlug(dynamicPage, normalizedSlug);

            logger.debug("Page entity was not found", {
              routeSegmentCount,
            });
            return null;
          }

          const candidates: EntityCandidate[] = pageStems.flatMap((stem) =>
            buildFileCandidates(
              projectDir,
              [pagesDirectory],
              stem,
              PAGE_FILE_EXTENSIONS,
            ).map((path) => ({ path, root: projectDir, virtualRoot: pagesDirectory }))
          );

          let directCandidateCount = 0;
          if (isVeryfrontRoute) {
            const directCandidates = buildFileCandidates(
              projectDir,
              [],
              normalizedSlug,
              DIRECT_ROUTE_EXTENSIONS,
            ).map(
              (path) => ({ path, root: projectDir, virtualRoot: ".veryfront" }),
            );
            directCandidateCount = directCandidates.length;
            candidates.unshift(...directCandidates);
          }

          const candidateResults: Array<EntityInfo | null> = [];
          for (const candidate of candidates) {
            context.throwIfCancelled();
            candidateResults.push(
              await getEntityInfoWithinRoot(
                candidate.path,
                candidate.root,
                adapter,
                candidate.virtualRoot,
                context,
              ),
            );
          }

          if (directCandidateCount > 0) {
            const directPage = selectPage(
              candidateResults.slice(0, directCandidateCount).filter(isPageEntityInfo),
              routeSegmentCount,
              "exact",
            );
            if (directPage) return withResolvedSlug(directPage, normalizedSlug);
          }

          const exactPage = selectPage(
            candidateResults.slice(directCandidateCount).filter(isPageEntityInfo),
            routeSegmentCount,
            "exact",
          );
          if (exactPage) return withResolvedSlug(exactPage, normalizedSlug);

          const dynamicPage = await findDynamicPageEntity(
            projectDir,
            normalizedSlug,
            adapter,
            pagesDirectory,
            context,
          );
          return dynamicPage ? withResolvedSlug(dynamicPage, normalizedSlug) : null;
        },
        {
          "entity.route_segments": routeSegmentCount,
        },
      ),
  );
}

/**
 * Resolves a layout entity by alias, project-relative path, or naming convention.
 *
 * Returns `null` when the requested layout cannot be found inside the project root.
 */
export async function getLayoutEntity(
  projectDir: string,
  layoutName: string,
  adapter?: RuntimeAdapter,
  options: EntityResolutionOptions = {},
): Promise<EntityInfo | null> {
  if (!isBoundedPath(projectDir) || !isBoundedPath(layoutName)) return null;
  const context = createResolutionContext(adapter, options);
  return await withProjectResolutionAdmission(
    getResolutionScope(projectDir, options),
    adapter,
    context,
    () =>
      withSpan(
        "types.getLayoutEntity",
        async () => {
          context.throwIfCancelled();
          let resolvedLayoutName = layoutName;
          if (layoutName.startsWith("@components/")) {
            resolvedLayoutName = layoutName.replace("@components/", "components/");
          } else if (layoutName.startsWith("@/")) {
            resolvedLayoutName = layoutName.substring(2);
          }

          if (!isSafeProjectRelativePath(resolvedLayoutName)) return null;

          if (/\.(mdx|md|tsx|jsx|ts|js)$/i.test(resolvedLayoutName)) {
            const directPath = pathHelper.join(projectDir, resolvedLayoutName);
            const info = await getEntityInfoWithinRoot(
              directPath,
              projectDir,
              adapter,
              "",
              context,
            );
            if (info?.entity.isLayout) return info;
            if (info && isCanonicalLayoutsPath(resolvedLayoutName)) {
              return asLayoutEntity(info);
            }
            // If explicit path with extension fails, don't fall back to convention-based discovery
            return null;
          }

          // Files in layouts/ are treated as layouts by convention (any extension)
          const layoutCandidatePaths = buildFileCandidates(
            projectDir,
            ["layouts"],
            resolvedLayoutName,
            LAYOUT_FILE_EXTENSIONS,
          );

          // Files in components/ must be detected as layouts by name/frontmatter
          const componentLayoutPaths = buildFileCandidates(
            projectDir,
            ["components"],
            `${resolvedLayoutName}Layout`,
            LAYOUT_FILE_EXTENSIONS,
          );
          const componentFallbackPaths = buildFileCandidates(
            projectDir,
            ["components"],
            "Layout",
            LAYOUT_FILE_EXTENSIONS,
          );

          const candidateResults: Array<EntityInfo | null> = [];
          for (
            const candidatePath of [
              ...layoutCandidatePaths,
              ...componentLayoutPaths,
              ...componentFallbackPaths,
            ]
          ) {
            context.throwIfCancelled();
            candidateResults.push(
              await getEntityInfoWithinRoot(
                candidatePath,
                projectDir,
                adapter,
                "",
                context,
              ),
            );
          }

          const layoutEnd = layoutCandidatePaths.length;
          const componentEnd = layoutEnd + componentLayoutPaths.length;
          const conventionalLayout = selectUniqueLayout(
            candidateResults.slice(0, layoutEnd).filter(isEntityInfo),
          );
          if (conventionalLayout) return conventionalLayout;

          const componentLayout = selectUniqueLayout(
            candidateResults.slice(layoutEnd, componentEnd).filter(isLayoutEntityInfo),
          );
          if (componentLayout) return componentLayout;

          const fallbackLayout = selectUniqueLayout(
            candidateResults.slice(componentEnd).filter(isLayoutEntityInfo),
          );
          if (fallbackLayout) return fallbackLayout;

          return null;
        },
        { "layout.has_name": layoutName.length > 0 },
      ),
  );
}

function buildFileCandidates(
  projectDir: string,
  segments: string[],
  relativeStem: string,
  extensions: readonly string[],
): string[] {
  return extensions.map((extension) =>
    pathHelper.join(projectDir, ...segments, `${relativeStem}.${extension}`)
  );
}

function isCanonicalLayoutsPath(projectRelativePath: string): boolean {
  const [rootSegment] = splitPathSegments(projectRelativePath).filter((segment) =>
    segment !== "" && segment !== "."
  );
  return rootSegment === "layouts";
}

function buildPageStems(normalizedSlug: string): string[] {
  return normalizedSlug === "" || normalizedSlug === "index"
    ? ["index"]
    : [normalizedSlug, `${normalizedSlug}/index`];
}

async function resolveAdapterPageCandidate(
  candidate: EntityCandidate,
  adapter: RuntimeAdapter | undefined,
  context: ResolutionContext,
): Promise<EntityInfo[]> {
  const resolveFile = context.authority.resolveFile;
  if (!resolveFile) return [];

  const pathSegments = splitPathSegments(candidate.path);
  const expectedStem = pathSegments.at(-1) ?? "";
  const parentDirectory = pathHelper.dirname(candidate.path);
  const discoveredPaths = new Set<string>();

  const resolvedPath = await awaitResolution(
    context,
    () => resolveFile.invoke(candidate.path),
  );
  logger.debug("Adapter page candidate resolved", {
    resolved: resolvedPath !== null,
  });
  if (resolvedPath === null) return [];
  if (typeof resolvedPath !== "string" || !isBoundedPath(resolvedPath)) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an invalid resolved path",
    });
  }

  try {
    const entries = await readDirectoryEntries(parentDirectory, context);
    for (const entry of entries) {
      if (
        entry.isFile &&
        isSafeDirectoryEntryName(entry.name) &&
        isPageFileStem(entry.name, expectedStem)
      ) {
        const discoveredPath = pathHelper.join(parentDirectory, entry.name);
        if (isBoundedPath(discoveredPath)) discoveredPaths.add(discoveredPath);
      }
    }
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
    /* expected: the candidate directory may not exist */
  }

  if (discoveredPaths.size === 0) discoveredPaths.add(resolvedPath);
  assertMatchingCandidateLimit(discoveredPaths.size);

  const results: Array<EntityInfo | null> = [];
  for (const path of [...discoveredPaths].sort(compareStrings)) {
    context.throwIfCancelled();
    results.push(
      await getEntityInfoWithinRoot(
        path,
        candidate.root,
        adapter,
        candidate.virtualRoot,
        context,
      ),
    );
  }
  return results.filter(isEntityInfo);
}

async function findDynamicPageEntity(
  projectDir: string,
  normalizedSlug: string,
  adapter?: RuntimeAdapter,
  pagesDirectory = "pages",
  context = createResolutionContext(adapter),
): Promise<EntityInfo | null> {
  const slugParts = normalizedSlug === "" || normalizedSlug === "index"
    ? []
    : normalizedSlug.split("/");
  const pagesRoot = pathHelper.join(projectDir, pagesDirectory);
  return await findPageInDirectory(
    pagesRoot,
    projectDir,
    pagesDirectory,
    slugParts,
    0,
    adapter,
    0,
    { directoriesVisited: 0, entriesInspected: 0 },
    context,
  );
}

async function findPageInDirectory(
  directoryPath: string,
  projectDir: string,
  pagesDirectory: string,
  slugParts: readonly string[],
  segmentIndex: number,
  adapter: RuntimeAdapter | undefined,
  dynamicDirectoryDepth: number,
  budget: DynamicTraversalBudget,
  context: ResolutionContext,
): Promise<EntityInfo | null> {
  context.throwIfCancelled();
  budget.directoriesVisited += 1;
  if (budget.directoriesVisited > MAX_DYNAMIC_DIRECTORIES) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail:
        `Dynamic route directory traversal exceeds the ${MAX_DYNAMIC_DIRECTORIES}-directory limit`,
    });
  }
  if (dynamicDirectoryDepth > slugParts.length + 1) return null;
  if (!isLexicallyWithinRoot(directoryPath, projectDir, pagesDirectory)) return null;

  let entries: DirectoryEntry[];
  try {
    const rawEntries = await readDirectoryEntries(directoryPath, context);
    budget.entriesInspected += rawEntries.length;
    if (budget.entriesInspected > MAX_DYNAMIC_ENTRIES) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: `Dynamic route traversal exceeds the ${MAX_DYNAMIC_ENTRIES}-entry limit`,
      });
    }
    entries = rawEntries.filter((entry) => isSafeDirectoryEntryName(entry.name));
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }

  const remainingSegmentCount = slugParts.length - segmentIndex;
  const exactResults: EntityInfo[] = [];

  if (remainingSegmentCount === 0) {
    exactResults.push(
      ...await loadPageEntries(
        directoryPath,
        entries.filter((entry) => entry.isFile && isPageFileStem(entry.name, "index")),
        projectDir,
        adapter,
        pagesDirectory,
        context,
      ),
    );
  } else {
    const segment = slugParts[segmentIndex] ?? "";
    if (remainingSegmentCount === 1) {
      exactResults.push(
        ...await loadPageEntries(
          directoryPath,
          entries.filter((entry) => entry.isFile && isPageFileStem(entry.name, segment)),
          projectDir,
          adapter,
          pagesDirectory,
          context,
        ),
      );
    }

    const literalDirectory = entries.find((entry) => entry.isDirectory && entry.name === segment);
    if (literalDirectory) {
      const nested = await findPageInDirectory(
        pathHelper.join(directoryPath, literalDirectory.name),
        projectDir,
        pagesDirectory,
        slugParts,
        segmentIndex + 1,
        adapter,
        dynamicDirectoryDepth,
        budget,
        context,
      );
      if (nested) exactResults.push(nested);
    }
  }

  const exactPage = selectPage(exactResults, slugParts.length, "exact");
  if (exactPage) return exactPage;

  const dynamicFiles = entries
    .filter((entry) => entry.isFile)
    .map((entry) => ({
      entry,
      priority: getDynamicPagePriority(entry.name, remainingSegmentCount),
    }))
    .filter(
      (candidate): candidate is { entry: DirectoryEntry; priority: number } =>
        candidate.priority !== null,
    );
  const dynamicDirectories = entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({
      entry,
      match: getDynamicDirectoryMatch(entry.name, remainingSegmentCount),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        entry: DirectoryEntry;
        match: { consumedSegments: number; priority: number };
      } => candidate.match !== null,
    );

  assertMatchingCandidateLimit(dynamicFiles.length);
  assertMatchingCandidateLimit(dynamicDirectories.length);

  for (const priority of [0, 1, 2]) {
    const matches: EntityInfo[] = await loadPageEntries(
      directoryPath,
      dynamicFiles
        .filter((candidate) => candidate.priority === priority)
        .map((candidate) => candidate.entry),
      projectDir,
      adapter,
      pagesDirectory,
      context,
    );

    for (const candidate of dynamicDirectories) {
      if (candidate.match.priority !== priority) continue;
      const nested = await findPageInDirectory(
        pathHelper.join(directoryPath, candidate.entry.name),
        projectDir,
        pagesDirectory,
        slugParts,
        segmentIndex + candidate.match.consumedSegments,
        adapter,
        dynamicDirectoryDepth + 1,
        budget,
        context,
      );
      if (nested) matches.push(nested);
    }

    const page = selectPage(matches, slugParts.length, "dynamic");
    if (page) return page;
  }

  return null;
}

function getDynamicPagePriority(
  fileName: string,
  remainingSegmentCount: number,
): number | null {
  const parameter = parseRouteParameterSegment(fileName);
  if (!parameter || !SUPPORTED_PAGE_SUFFIX_PATTERN.test(parameter.suffix)) {
    return null;
  }
  switch (parameter.kind) {
    case "optional-catch-all":
      return 2;
    case "catch-all":
      return remainingSegmentCount > 0 ? 1 : null;
    case "dynamic":
      return remainingSegmentCount === 1 ? 0 : null;
  }
}

function getDynamicDirectoryMatch(
  directoryName: string,
  remainingSegmentCount: number,
): { consumedSegments: number; priority: number } | null {
  const parameter = parseRouteParameterSegment(directoryName);
  if (!parameter || parameter.suffix !== "") return null;
  switch (parameter.kind) {
    case "optional-catch-all":
      return { consumedSegments: remainingSegmentCount, priority: 2 };
    case "catch-all":
      return remainingSegmentCount > 0
        ? { consumedSegments: remainingSegmentCount, priority: 1 }
        : null;
    case "dynamic":
      return remainingSegmentCount > 0 ? { consumedSegments: 1, priority: 0 } : null;
  }
}

function isPageFileStem(fileName: string, expectedStem: string): boolean {
  if (!SUPPORTED_PAGE_EXTENSION_PATTERN.test(fileName)) return false;
  return fileName.replace(SUPPORTED_PAGE_EXTENSION_PATTERN, "") === expectedStem;
}

function isSafeDirectoryEntryName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." &&
    name.length <= MAX_PATH_LENGTH_CHARS &&
    !containsPathControlCharacters(name) &&
    !name.includes("/") && !name.includes("\\");
}

async function loadPageEntries(
  directoryPath: string,
  entries: readonly DirectoryEntry[],
  projectDir: string,
  adapter: RuntimeAdapter | undefined,
  pagesDirectory: string,
  context: ResolutionContext,
): Promise<EntityInfo[]> {
  assertMatchingCandidateLimit(entries.length);
  const candidates: EntityInfo[] = [];
  for (const entry of entries) {
    context.throwIfCancelled();
    const info = await getEntityInfoWithinRoot(
      pathHelper.join(directoryPath, entry.name),
      projectDir,
      adapter,
      pagesDirectory,
      context,
    );
    if (info?.entity.isPage) candidates.push(info);
  }
  return candidates;
}

function assertMatchingCandidateLimit(candidateCount: number): void {
  if (candidateCount <= MAX_MATCHING_ROUTE_CANDIDATES) return;
  throw DYNAMIC_ROUTE_ERROR.create({
    detail: `Matching route candidates exceed the ${MAX_MATCHING_ROUTE_CANDIDATES}-candidate limit`,
    context: { candidateCount },
  });
}

function selectPage(
  candidates: readonly EntityInfo[],
  routeSegmentCount: number,
  matchKind: "dynamic" | "exact",
): EntityInfo | null {
  const uniqueCandidates = new Map<string, EntityInfo>();
  for (const candidate of candidates) {
    uniqueCandidates.set(candidate.entity.path, candidate);
  }
  if (uniqueCandidates.size > 1) {
    throw ROUTE_CONFLICT.create({
      detail: `Multiple ${matchKind} page files match the same route`,
      context: {
        candidateCount: uniqueCandidates.size,
        routeSegmentCount,
      },
    });
  }
  return uniqueCandidates.values().next().value ?? null;
}

function isPageEntityInfo(candidate: EntityInfo | null): candidate is EntityInfo {
  return candidate?.entity.isPage === true;
}

function withResolvedSlug(info: EntityInfo, normalizedSlug: string): EntityInfo {
  return {
    ...info,
    entity: {
      ...info.entity,
      slug: normalizedSlug === "index" ? "" : normalizedSlug,
    },
  };
}

async function readDirectoryEntries(
  pagesDir: string,
  context: ResolutionContext,
): Promise<DirectoryEntry[]> {
  const collectEntries = async (iterator: AsyncIterable<unknown>): Promise<DirectoryEntry[]> => {
    const entries: DirectoryEntry[] = [];
    for await (const entry of iterator) {
      context.throwIfCancelled();
      if (entries.length >= MAX_DIRECTORY_ENTRIES) {
        throw DYNAMIC_ROUTE_ERROR.create({
          detail: `Route directory entries exceed the ${MAX_DIRECTORY_ENTRIES}-entry limit`,
        });
      }
      entries.push(snapshotDirectoryEntry(entry));
    }
    return entries;
  };

  const readDir = context.authority.readDir;
  if (!readDir) {
    throw INVALID_ROUTE_FILE.create({
      detail: "Route filesystem must provide a readDir data-property method",
    });
  }
  return await awaitResolution(
    context,
    () => collectEntries(readDir.invoke(pagesDir)),
  );
}

function getSlugFromPath(filePath: string, routeRoot?: string): string {
  const parts = splitPathSegments(filePath);
  const fileName = parts[parts.length - 1] ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?)$/i, "");
  if (slug.toLowerCase() !== "index") return slug;

  if (routeRoot !== undefined) {
    const parent = pathHelper.dirname(filePath);
    if (!hasPathPrefix(parent, routeRoot)) return "";
    const relativeParent = pathHelper.relative(routeRoot, parent).replaceAll("\\", "/");
    return relativeParent === "." ? "" : normalizeSlug(relativeParent);
  }
  const parentDir = parts[parts.length - 2];
  return parentDir ?? "";
}

function splitPathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]/);
}

function normalizeSlug(slug: string): string {
  return slug.split("/").filter((segment) => segment !== "" && segment !== ".").join("/");
}

function countPathSegments(path: string): number {
  return path === "" ? 0 : path.split("/").filter(Boolean).length;
}

function isSafeProjectRelativePath(path: string): boolean {
  return isBoundedPath(path) &&
    !pathHelper.isAbsolute(path) &&
    path.split(/[\\/]/).every((segment) => segment !== "..");
}

function isSafeRouteSlug(slug: string): boolean {
  return isSafeProjectRelativePath(slug) && !slug.includes("\\");
}

function isBoundedPath(path: unknown): path is string {
  return typeof path === "string" && path.length <= MAX_PATH_LENGTH_CHARS &&
    !containsPathControlCharacters(path);
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PATH_LENGTH_CHARS &&
    !containsPathControlCharacters(value);
}

function snapshotDirectoryEntry(value: unknown): DirectoryEntry {
  if (typeof value !== "object" || value === null) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an invalid directory entry",
    });
  }
  let nameDescriptor: PropertyDescriptor | undefined;
  let isFileDescriptor: PropertyDescriptor | undefined;
  let isDirectoryDescriptor: PropertyDescriptor | undefined;
  try {
    nameDescriptor = Reflect.getOwnPropertyDescriptor(value, "name");
    isFileDescriptor = Reflect.getOwnPropertyDescriptor(value, "isFile");
    isDirectoryDescriptor = Reflect.getOwnPropertyDescriptor(value, "isDirectory");
  } catch {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an unreadable directory entry",
    });
  }
  if (
    !nameDescriptor?.enumerable || !("value" in nameDescriptor) ||
    !isFileDescriptor?.enumerable || !("value" in isFileDescriptor) ||
    !isDirectoryDescriptor?.enumerable || !("value" in isDirectoryDescriptor)
  ) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an invalid directory entry",
    });
  }
  const name: unknown = nameDescriptor.value;
  const isFile: unknown = isFileDescriptor.value;
  const isDirectory: unknown = isDirectoryDescriptor.value;
  if (
    typeof name !== "string" || typeof isFile !== "boolean" ||
    typeof isDirectory !== "boolean" || (isFile && isDirectory)
  ) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an invalid directory entry",
    });
  }
  return Object.freeze({ name, isFile, isDirectory });
}

function isEntityInfo(value: EntityInfo | null): value is EntityInfo {
  return value !== null;
}

function isLayoutEntityInfo(value: EntityInfo | null): value is EntityInfo {
  return value?.entity.isLayout === true;
}

function selectUniqueLayout(candidates: readonly EntityInfo[]): EntityInfo | null {
  if (candidates.length > 1) {
    throw ROUTE_CONFLICT.create({
      detail: "Multiple layout files match the same layout",
      context: { candidateCount: candidates.length },
    });
  }
  const info = candidates[0];
  return info ? asLayoutEntity(info) : null;
}

function asLayoutEntity(info: EntityInfo): EntityInfo {
  return {
    ...info,
    entity: {
      ...info.entity,
      type: "layout",
      isLayout: true,
      isComponent: false,
      isPage: false,
    },
  };
}

async function getEntityInfoWithinRoot(
  filePath: string,
  rootDir: string,
  adapter?: RuntimeAdapter,
  virtualRoot = "",
  context = createResolutionContext(adapter),
): Promise<EntityInfo | null> {
  if (
    !isBoundedPath(filePath) ||
    !isBoundedPath(rootDir) ||
    !isBoundedPath(virtualRoot)
  ) return null;
  if (!isLexicallyWithinRoot(filePath, rootDir, virtualRoot)) return null;

  let content: string;
  try {
    if (context.authority.symlinkFree) {
      const source = await awaitResolution(
        context,
        () =>
          context.authority.bounded.readUtf8(
            filePath,
            MAX_ENTITY_SOURCE_BYTES,
            "Entity source",
          ),
      );
      content = source.content;
    } else {
      const snapshot = context.authority.snapshot;
      if (!snapshot) {
        throw INVALID_ROUTE_FILE.create({
          detail:
            "Route filesystem must provide a root-bound stable snapshot reader when links may be resolved",
        });
      }
      const bytes = await awaitResolution(
        context,
        () => snapshot.read(filePath, rootDir, MAX_ENTITY_SOURCE_BYTES),
      );
      content = strictTextDecoder.decode(bytes);
    }
  } catch (error) {
    if (isFileNotFoundError(error) || isFileSnapshotPathError(error)) return null;
    throw error;
  }

  return createEntityInfo(
    filePath,
    content,
    context.authority,
    getExplicitRouteRoot(filePath, rootDir, virtualRoot),
  );
}

function getExplicitRouteRoot(
  filePath: string,
  rootDir: string,
  virtualRoot: string,
): string | undefined {
  if (virtualRoot === "" || virtualRoot === ".") return undefined;
  const rootedRouteDirectory = pathHelper.join(rootDir, virtualRoot);
  if (hasPathPrefix(filePath, rootedRouteDirectory)) return rootedRouteDirectory;
  return hasPathPrefix(filePath, virtualRoot) ? virtualRoot : undefined;
}

function isLexicallyWithinRoot(
  filePath: string,
  rootDir: string,
  virtualRoot = "",
): boolean {
  if (filePath.split(/[\\/]/).some((segment) => segment === "..")) return false;

  const fileIsAbsolute = pathHelper.isAbsolute(filePath);
  const rootIsAbsolute = pathHelper.isAbsolute(rootDir);
  if (fileIsAbsolute) return rootIsAbsolute && hasPathPrefix(filePath, rootDir);
  if (!rootIsAbsolute && hasPathPrefix(filePath, rootDir)) return true;
  return virtualRoot === "" || virtualRoot === "."
    ? !rootIsAbsolute
    : hasPathPrefix(filePath, virtualRoot);
}

function hasNoSymlinkSemantics(
  fileSystem: FileSystemAdapter | FileSystem,
): boolean {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(fileSystem, "symlinkSemantics");
    return descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.value === "none";
  } catch {
    return false;
  }
}

function hasPathPrefix(filePath: string, rootDir: string): boolean {
  const normalizedPath = normalizeComparablePath(filePath);
  const normalizedRoot = normalizeComparablePath(rootDir);
  if (normalizedRoot === ".") {
    return !pathHelper.isAbsolute(normalizedPath) &&
      normalizedPath !== ".." &&
      !normalizedPath.startsWith("../");
  }
  const descendantPrefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(descendantPrefix);
}

function normalizeComparablePath(path: string): string {
  const normalized = pathHelper.normalize(path.replace(/\\/g, "/"));
  const withoutTrailingSlash = normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)
    ? normalized
    : normalized.replace(/\/$/, "");
  return /^[A-Za-z]:\//.test(withoutTrailingSlash)
    ? withoutTrailingSlash.toLowerCase()
    : withoutTrailingSlash;
}
