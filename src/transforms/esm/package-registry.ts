/****
 * Central package version registry and dependency-pinning snapshot accessors.
 *
 * React CDN URL building lives in ./react-cdn.ts.
 */

import { rendererLogger } from "#veryfront/utils";
import { hashString } from "#veryfront/cache/hash.ts";
import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";
import type {
  FileInfo,
  FileSystemAdapter,
  RuntimeAdapter,
} from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";

const logger = rendererLogger.component("package-registry");
import type { VeryfrontConfig } from "#veryfront/config";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  readDependencyPinningCohortConfig,
  resolveDependencyPinningCohort,
} from "./dependency-pinning-cohort.ts";
import { isExactSemver } from "./npm-registry-client.ts";
import { DEFAULT_REACT_VERSION } from "../import-rewriter/url-builder.ts";

interface CachedDependencyVersions {
  mtimeMs: number | null;
  react?: string;
  veryfront?: string;
  /** Full merged dependency map (dependencies + devDependencies, raw semver strings). */
  dependencies?: Record<string, string>;
  /** Stable hash of the sorted dependency map, computed only while pinning is enabled. */
  dependencyPinHash?: string;
}

const dependencyVersionCache = new Map<string, CachedDependencyVersions>();
/**
 * The one dependency snapshot currently authoritative for each package source.
 *
 * Historical snapshots remain available for deterministic renders, but only
 * this bounded map may authorize a platform package.json write-back.
 */
const currentDependencyPinningKeys = new Map<string, string>();
type DependencyVersionsResult = {
  react?: string;
  veryfront?: string;
  dependencies?: Record<string, string>;
  dependencyState?: "verified" | "absent" | "unknown";
};
const pendingDependencyVersionReads = new Map<
  string,
  Promise<DependencyVersionsResult>
>();
let dependencyVersionReadOperations = 0;
const DEPENDENCY_VERSION_CACHE_MAX_ENTRIES = 256;
const CURRENT_DEPENDENCY_SNAPSHOT_MAX_ENTRIES = 256;
const DEPENDENCY_SNAPSHOT_MAX_ENTRIES = 4_096;

function trimCurrentDependencyPinningKeys(): void {
  while (currentDependencyPinningKeys.size > CURRENT_DEPENDENCY_SNAPSHOT_MAX_ENTRIES) {
    const oldest = currentDependencyPinningKeys.keys().next().value;
    if (oldest === undefined) break;
    currentDependencyPinningKeys.delete(oldest);
  }
}

function setCurrentDependencyPinningKey(
  cacheIdentity: string,
  cacheKey: string,
): void {
  currentDependencyPinningKeys.delete(cacheIdentity);
  currentDependencyPinningKeys.set(cacheIdentity, cacheKey);
  trimCurrentDependencyPinningKeys();
}

function trimDependencyVersionCache(): void {
  while (dependencyVersionCache.size > DEPENDENCY_VERSION_CACHE_MAX_ENTRIES) {
    let evicted = false;
    for (const cacheIdentity of dependencyVersionCache.keys()) {
      if (
        pendingDependencyVersionReads.has(`${cacheIdentity}\0on`) ||
        pendingDependencyVersionReads.has(`${cacheIdentity}\0off`)
      ) {
        continue;
      }
      dependencyVersionCache.delete(cacheIdentity);
      currentDependencyPinningKeys.delete(cacheIdentity);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}

function setDependencyVersionCache(
  cacheIdentity: string,
  value: CachedDependencyVersions,
): void {
  // Reading new package bytes invalidates the previous authority token until
  // getDependencyPinningSnapshot has atomically captured and remembered the
  // corresponding immutable snapshot.
  currentDependencyPinningKeys.delete(cacheIdentity);
  dependencyVersionCache.delete(cacheIdentity);
  dependencyVersionCache.set(cacheIdentity, value);
  trimDependencyVersionCache();
}

function getDependencyVersionCache(
  cacheIdentity: string,
): CachedDependencyVersions | undefined {
  const cached = dependencyVersionCache.get(cacheIdentity);
  if (!cached) return undefined;
  dependencyVersionCache.delete(cacheIdentity);
  dependencyVersionCache.set(cacheIdentity, cached);
  return cached;
}

export interface DependencyPinningSnapshot {
  readonly cacheKey: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly configuredVersions?: Readonly<{
    react?: Readonly<{ declaration: string; effective: string }>;
    veryfront?: Readonly<{ declaration: string; effective: string }>;
  }>;
}

export type DependencyWritebackTarget =
  | Readonly<{ kind: "main" }>
  | Readonly<{ kind: "branch"; branch: string }>;

export interface DependencyWritebackTargetContext {
  readonly environment?: "preview" | "production";
  readonly isLocalProject?: boolean;
  readonly releaseId?: string | null;
  readonly branch?: string | null;
}

/**
 * Derive a writable platform target only from an explicit mutable preview
 * context. Production, release, missing-mode, and malformed branch contexts
 * are intentionally read-only.
 */
export function resolveDependencyWritebackTarget(
  context: DependencyWritebackTargetContext,
): DependencyWritebackTarget | undefined {
  if (
    context.environment !== "preview" ||
    context.isLocalProject !== false ||
    context.releaseId != null
  ) return undefined;
  if (
    typeof context.branch === "string" &&
    (context.branch.length === 0 || context.branch !== context.branch.trim())
  ) return undefined;
  return context.branch && context.branch !== "main"
    ? Object.freeze({ kind: "branch", branch: context.branch })
    : Object.freeze({ kind: "main" });
}

export interface DependencyPinningSource {
  readonly projectDir: string | null | undefined;
  /** Adapter-backed reads are required for proxy/cloud projects. */
  readonly fs?: Pick<FileSystemAdapter, "readFile" | "stat">;
  /** Stable project + content-source namespace for shared proxy projectDir values. */
  readonly cacheNamespace?: string;
  /** Stable project identity used to resolve the pinning rollout cohort. */
  readonly projectId?: string | null;
  /** Dependency-affecting overrides captured into the immutable snapshot. */
  readonly config?: VeryfrontConfig | null;
  /** Content source provenance used to prevent non-main API write-back. */
  readonly contentSourceId?: string | null;
  /** Immutable release provenance used to prevent main-project write-back. */
  readonly releaseId?: string | null;
  /** Branch provenance used to route preview write-back to the exact branch. */
  readonly branch?: string | null;
  /** Explicit writable platform target; absent for release/production sources. */
  readonly dependencyWritebackTarget?: DependencyWritebackTarget;
  /** Request-scoped bearer token used only by the platform write-back transport. */
  readonly dependencyWritebackToken?: string;
}

export type DependencyPinningSourceInput =
  | string
  | null
  | undefined
  | DependencyPinningSource;

export interface CreateDependencyPinningSourceOptions {
  projectDir: string;
  adapter?: RuntimeAdapter;
  projectId?: string | null;
  projectSlug?: string | null;
  contentSourceId?: string | null;
  releaseId?: string | null;
  branch?: string | null;
  isLocalProject?: boolean;
  config?: VeryfrontConfig | null;
  dependencyWritebackTarget?: DependencyWritebackTarget;
  dependencyWritebackToken?: string;
}

/**
 * Build a request-scoped package source. Local callers retain the host-filesystem
 * fast path; virtual/proxy adapters read package.json through the active adapter
 * context and isolate caches by project plus release/branch content source.
 */
export function createDependencyPinningSource(
  options: CreateDependencyPinningSourceOptions,
): DependencyPinningSource {
  const adapterFs = options.adapter &&
      (options.isLocalProject === false ||
        (options.isLocalProject === undefined && isVirtualFilesystem(options.adapter.fs)))
    ? options.adapter.fs
    : undefined;
  const projectKey = options.projectId
    ? `id:${options.projectId}`
    : options.projectSlug
    ? `slug:${options.projectSlug}`
    : `dir:${options.projectDir}`;
  const contentKey = options.contentSourceId
    ? `content:${options.contentSourceId}`
    : options.releaseId
    ? `release:${options.releaseId}`
    : `branch:${options.branch ?? "main"}`;

  return {
    projectDir: options.projectDir,
    projectId: options.projectId,
    config: options.config,
    contentSourceId: options.contentSourceId,
    releaseId: options.releaseId,
    branch: options.branch,
    dependencyWritebackTarget: options.dependencyWritebackTarget
      ? Object.freeze({ ...options.dependencyWritebackTarget })
      : undefined,
    dependencyWritebackToken: options.dependencyWritebackToken,
    ...(adapterFs
      ? {
        fs: adapterFs,
        cacheNamespace: JSON.stringify([projectKey, contentKey]),
      }
      : {}),
  };
}

const dependencyPinningSnapshots = new Map<string, DependencyPinningSnapshot>();
const FLAG_OFF_DEPENDENCY_SNAPSHOT: DependencyPinningSnapshot = Object.freeze({
  cacheKey: "off",
});

/**
 * Validate the same exact SemVer forms accepted by dependency pinning.
 */
export function isValidReactVersion(version: string): boolean {
  return isExactSemver(version);
}

/**
 * Validate and normalize React version.
 */
export function normalizeReactVersion(version: string | undefined): string {
  if (!version) return DEFAULT_REACT_VERSION;
  if (isValidReactVersion(version)) return version;

  rendererLogger.warn(
    `Invalid exact React SemVer "${version}". Using default: ${DEFAULT_REACT_VERSION}`,
  );
  return DEFAULT_REACT_VERSION;
}

/**
 * Strip semver range prefixes (^, ~, >=, >, <=, <, =) from a version string.
 */
export function stripSemverRange(version: string): string {
  return version.replace(/^[~^>=<]+/, "");
}

/**
 * Compatibility no-op. Kept for tests and older call sites.
 */
export function clearReactVersionCache(): void {
  dependencyVersionCache.clear();
  dependencyPinningSnapshots.clear();
  currentDependencyPinningKeys.clear();
}

/** Number of non-coalesced package.json refresh operations. Tests only. */
export function _getDependencyVersionReadOperationsForTest(): number {
  return dependencyVersionReadOperations;
}

/**
 * For tests only — prime the in-process dependency cache for a given project directory,
 * simulating a package.json that has already been read by readProjectDependencyVersions.
 */
export function _primeDependenciesCache(
  projectDir: string,
  dependencies: Record<string, string>,
): void {
  const dependencyMap = copyDependencyMap(dependencies);
  setDependencyVersionCache(normalizeDependencyPinningSource(projectDir).cacheIdentity, {
    mtimeMs: null,
    dependencies: dependencyMap,
    dependencyPinHash: hashDependencyPins(dependencyMap),
  });
}

/**
 * Synchronously return the full dependency map for a project from the in-process
 * cache, or undefined when the cache has not been warmed yet.
 *
 * The cache is populated by readProjectDependencyVersions(). Call sites that
 * need the map synchronously (e.g. import rewrite strategies) should trigger
 * an async warm-up early in the request lifecycle and then use this accessor.
 */
export function getProjectDependenciesSync(
  source: DependencyPinningSourceInput,
  expectedCacheKey?: string,
): Record<string, string> | undefined {
  const normalized = normalizeDependencyPinningSource(source);
  if (!normalized.packageJsonPath) return undefined;
  if (expectedCacheKey) {
    return dependencyPinningSnapshots.get(
      dependencySnapshotKey(normalized.cacheIdentity, expectedCacheKey),
    )?.dependencies as Record<string, string> | undefined;
  }
  return getDependencyVersionCache(normalized.cacheIdentity)?.dependencies;
}

/**
 * When VERYFRONT_DEPENDENCY_PINNING=1, ensure the project's package.json has
 * been read into the in-process dependency cache. No-op when the flag is off
 * or when projectDir is absent. Repeat calls within the same process are cheap
 * because readProjectDependencyVersions is mtime-guarded.
 *
 * Call this early in each request/build lifecycle — before any synchronous
 * getProjectDependenciesSync calls run — so that bare-import pin lookups find
 * the cache warm even when resolveProjectReactVersion is bypassed (e.g. when
 * config.react.version is set or an explicitReactVersion is supplied by the
 * caller).
 */
export async function ensureProjectDependenciesLoaded(
  source: DependencyPinningSourceInput,
): Promise<void> {
  await getDependencyPinningCacheKey(source);
}

function getPackageJsonPath(projectDir: string): string {
  return `${projectDir}/package.json`;
}

interface NormalizedDependencyPinningSource {
  projectDir: string | null | undefined;
  packageJsonPath?: string;
  cacheIdentity: string;
  fs?: Pick<FileSystemAdapter, "readFile" | "stat">;
  config?: VeryfrontConfig | null;
}

function normalizeDependencyPinningSource(
  source: DependencyPinningSourceInput,
): NormalizedDependencyPinningSource {
  const objectSource = typeof source === "object" && source !== null ? source : undefined;
  const projectDir = objectSource ? objectSource.projectDir : source as string | null | undefined;
  const packageJsonPath = projectDir ? getPackageJsonPath(projectDir) : undefined;
  const cacheIdentity = packageJsonPath && objectSource?.cacheNamespace
    ? `${objectSource.cacheNamespace}\0${packageJsonPath}`
    : packageJsonPath ?? "no-project";

  return {
    projectDir,
    packageJsonPath,
    cacheIdentity,
    fs: objectSource?.fs,
    config: objectSource?.config,
  };
}

function hashDependencyPins(
  dependencies: Readonly<Record<string, string>>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (!configuredVersions?.react && !configuredVersions?.veryfront) {
    return hashString(JSON.stringify(sortedEntries));
  }
  return hashString(JSON.stringify({
    dependencies: sortedEntries,
    configuredVersions,
  }));
}

function dependencyMapsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName)
  );
  const rightEntries = Object.entries(right).sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName)
  );
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function copyDependencyMap(
  ...sources: ReadonlyArray<Readonly<Record<string, string>>>
): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  for (const source of sources) {
    for (const [name, declaration] of Object.entries(source)) {
      result[name] = declaration;
    }
  }
  return result;
}

function dependencySnapshotKey(cacheIdentity: string, cacheKey: string): string {
  return `${cacheIdentity}\0${cacheKey}`;
}

function freezeConfiguredVersions(
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): DependencyPinningSnapshot["configuredVersions"] {
  return configuredVersions
    ? Object.freeze({
      ...(configuredVersions.react
        ? { react: Object.freeze({ ...configuredVersions.react }) }
        : {}),
      ...(configuredVersions.veryfront
        ? { veryfront: Object.freeze({ ...configuredVersions.veryfront }) }
        : {}),
    })
    : undefined;
}

function rememberDependencyPinningSnapshot(
  cacheIdentity: string,
  cacheKey: string,
  dependencies?: Record<string, string>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): DependencyPinningSnapshot {
  const snapshot: DependencyPinningSnapshot = Object.freeze({
    cacheKey,
    dependencies: dependencies ? Object.freeze(copyDependencyMap(dependencies)) : undefined,
    configuredVersions: freezeConfiguredVersions(configuredVersions),
  });
  const key = dependencySnapshotKey(cacheIdentity, cacheKey);
  if (
    !dependencyPinningSnapshots.has(key) &&
    dependencyPinningSnapshots.size >= DEPENDENCY_SNAPSHOT_MAX_ENTRIES
  ) {
    const oldest = dependencyPinningSnapshots.keys().next().value;
    if (oldest !== undefined) dependencyPinningSnapshots.delete(oldest);
  }
  dependencyPinningSnapshots.set(key, snapshot);
  return snapshot;
}

function getDependencyPinningSnapshotSync(
  source: DependencyPinningSourceInput,
  cacheKey: string,
): DependencyPinningSnapshot | undefined {
  if (cacheKey === "off") return FLAG_OFF_DEPENDENCY_SNAPSHOT;
  if (cacheKey === "on:unknown") return undefined;
  const normalized = normalizeDependencyPinningSource(source);
  return dependencyPinningSnapshots.get(
    dependencySnapshotKey(normalized.cacheIdentity, cacheKey),
  );
}

/**
 * Return an already verified snapshot without consulting project metadata.
 * Browser-module callers use this as an I/O-free fast path so a remembered
 * request snapshot need not re-read package metadata.
 */
export function getRememberedDependencyPinningSnapshot(
  source: DependencyPinningSourceInput,
  cacheKey: string,
): DependencyPinningSnapshot | undefined {
  return getDependencyPinningSnapshotSync(source, cacheKey);
}

/**
 * Return whether a snapshot is still the authoritative current package state
 * for this exact source namespace. Remembered historical snapshots deliberately
 * return false even though they remain valid render inputs.
 */
export function isCurrentDependencyPinningSnapshot(
  source: DependencyPinningSourceInput,
  cacheKey: string,
): boolean {
  if (!cacheKey.startsWith("on:") || cacheKey === "on:unknown") return false;
  const normalized = normalizeDependencyPinningSource(source);
  if (!normalized.packageJsonPath) return false;
  if (currentDependencyPinningKeys.get(normalized.cacheIdentity) !== cacheKey) {
    return false;
  }

  // Keep actively checked authorities warm in the bounded LRU map.
  currentDependencyPinningKeys.delete(normalized.cacheIdentity);
  currentDependencyPinningKeys.set(normalized.cacheIdentity, cacheKey);
  return true;
}

/**
 * Resolve an optional URL/request snapshot token. Remembered historical
 * snapshots take the synchronous fast path so a module graph does not stat
 * package.json once per child request. A miss performs one current read to
 * support fresh processes, then fails closed if the requested history is not
 * available locally.
 */
export async function resolveRequestedDependencyPinningSnapshot(
  source: DependencyPinningSourceInput,
  requestedCacheKey?: string | null,
): Promise<DependencyPinningSnapshot | undefined> {
  if (requestedCacheKey === "on:unknown") return undefined;
  if (requestedCacheKey) {
    const remembered = getDependencyPinningSnapshotSync(
      source,
      requestedCacheKey,
    );
    if (remembered) return remembered;
  }

  const current = await getDependencyPinningSnapshot(source);
  if (current.cacheKey === "on:unknown") return undefined;
  if (!requestedCacheKey || requestedCacheKey === current.cacheKey) {
    return current;
  }
  return getDependencyPinningSnapshotSync(source, requestedCacheKey);
}

/**
 * Resolve a caller-supplied dependency snapshot without ever pairing an `on:`
 * key with an unrelated or missing dependency map.
 */
export async function resolveDependencyPinningSnapshot(
  source: DependencyPinningSourceInput,
  cacheKey?: string,
  dependencies?: Readonly<Record<string, string>>,
): Promise<DependencyPinningSnapshot> {
  if (!cacheKey) {
    const current = await getDependencyPinningSnapshot(source);
    if (current.cacheKey === "on:unknown") {
      throw new Error("Dependency pinning snapshot is unavailable: on:unknown");
    }
    return current;
  }
  if (cacheKey === "off") return FLAG_OFF_DEPENDENCY_SNAPSHOT;
  if (!isCanonicalDependencyPinningCacheKey(cacheKey)) {
    throw new Error(`Invalid dependency pinning snapshot key: ${cacheKey}`);
  }

  if (dependencies !== undefined) {
    const copiedDependencies = copyDependencyMap(dependencies);
    const remembered = getDependencyPinningSnapshotSync(source, cacheKey);
    if (remembered) {
      if (
        !remembered.dependencies ||
        !dependencyMapsEqual(remembered.dependencies, copiedDependencies)
      ) {
        throw new Error(
          `Dependency pinning snapshot key does not match supplied dependencies: ${cacheKey}`,
        );
      }
      return remembered;
    }

    const configuredVersions = captureConfiguredVersions(
      normalizeDependencyPinningSource(source).config,
    );
    const matchesDependencyMap = `on:${hashDependencyPins(copiedDependencies)}` === cacheKey;
    const matchesConfiguredVersions = configuredVersions !== undefined &&
      `on:${hashDependencyPins(copiedDependencies, configuredVersions)}` === cacheKey;
    if (!matchesDependencyMap && !matchesConfiguredVersions) {
      throw new Error(
        `Dependency pinning snapshot key does not match supplied dependencies: ${cacheKey}`,
      );
    }
    const immutableDependencies = Object.freeze(copiedDependencies);
    return Object.freeze({
      cacheKey,
      dependencies: immutableDependencies,
      configuredVersions: matchesConfiguredVersions
        ? freezeConfiguredVersions(configuredVersions)
        : undefined,
    });
  }

  if (normalizeDependencyPinningSource(source).projectDir) {
    const remembered = getDependencyPinningSnapshotSync(source, cacheKey);
    if (remembered) return remembered;
  }

  throw new Error(`Dependency pinning snapshot is unavailable: ${cacheKey}`);
}

/**
 * Return a compact cache-key fragment for every transform-affecting dependency
 * pin input. The flag state is explicit, and the enabled state hashes the full
 * sorted dependencies + devDependencies map so package.json edits invalidate
 * transformed and hydration output even when source bytes are unchanged.
 *
 * Calling this function also centralizes the async package.json warm-up needed
 * by synchronous import-rewrite strategies.
 */
export async function getDependencyPinningCacheKey(
  source: DependencyPinningSourceInput,
): Promise<string> {
  return (await getDependencyPinningSnapshot(source)).cacheKey;
}

/**
 * Atomically capture the dependency cache key and the exact immutable package
 * map that produced it. Callers must keep the pair together so an interleaved
 * package.json refresh cannot store state-B output under state-A's cache key.
 */
export async function getDependencyPinningSnapshot(
  source: DependencyPinningSourceInput,
): Promise<DependencyPinningSnapshot> {
  const normalized = normalizeDependencyPinningSource(source);
  if (getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) !== "1") {
    currentDependencyPinningKeys.delete(normalized.cacheIdentity);
    return FLAG_OFF_DEPENDENCY_SNAPSHOT;
  }
  // The flag arms the rollout; the cohort decides who is in it. Returning the
  // flag-off snapshot keeps out-of-cohort projects byte-identical to today,
  // including their render cache identities.
  const cohortProjectId = typeof source === "object" && source !== null
    ? source.projectId
    : undefined;
  if (
    !resolveDependencyPinningCohort(cohortProjectId, readDependencyPinningCohortConfig())
  ) {
    currentDependencyPinningKeys.delete(normalized.cacheIdentity);
    return FLAG_OFF_DEPENDENCY_SNAPSHOT;
  }
  if (!normalized.packageJsonPath) {
    return Object.freeze({ cacheKey: "on:no-project" });
  }

  // An in-progress refresh must not leave the previous snapshot authorized.
  currentDependencyPinningKeys.delete(normalized.cacheIdentity);
  const result = await readProjectDependencyVersions(source);
  if (result.dependencyState === "unknown") {
    currentDependencyPinningKeys.delete(normalized.cacheIdentity);
    return Object.freeze({ cacheKey: "on:unknown" });
  }
  const configuredVersions = captureConfiguredVersions(normalized.config);
  const dependencies = applyConfiguredDependencyOverrides(
    result.dependencies ?? {},
    configuredVersions,
  );
  const pinHash = hashDependencyPins(dependencies, configuredVersions);
  const cacheKey = `on:${pinHash}`;
  const snapshot = rememberDependencyPinningSnapshot(
    normalized.cacheIdentity,
    cacheKey,
    dependencies,
    configuredVersions,
  );
  setCurrentDependencyPinningKey(normalized.cacheIdentity, cacheKey);
  return snapshot;
}

function getMtimeMs(mtime: Date | null | undefined): number | null {
  return mtime instanceof Date ? mtime.getTime() : null;
}

function parseDependencySection(
  value: unknown,
  field: "dependencies" | "devDependencies",
): Record<string, string> {
  if (value === undefined) return copyDependencyMap();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`package.json ${field} must be an object`);
  }

  const result = copyDependencyMap();
  for (const [name, declaration] of Object.entries(value)) {
    if (typeof declaration !== "string") {
      throw new Error(`package.json ${field}.${name} must be a string`);
    }
    result[name] = declaration;
  }
  return result;
}

function parsePackageDependencyMap(content: string): Record<string, string> {
  const parsed: unknown = JSON.parse(content);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("package.json root must be an object");
  }
  const pkg = parsed as Record<string, unknown>;
  return copyDependencyMap(
    parseDependencySection(pkg.dependencies, "dependencies"),
    parseDependencySection(pkg.devDependencies, "devDependencies"),
  );
}

export async function readProjectDependencyVersions(
  source: DependencyPinningSourceInput,
): Promise<DependencyVersionsResult> {
  const normalized = normalizeDependencyPinningSource(source);
  if (!normalized.packageJsonPath) return { dependencyState: "absent" };
  const pinningOn = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) === "1";
  const pendingKey = `${normalized.cacheIdentity}\0${pinningOn ? "on" : "off"}`;
  const pending = pendingDependencyVersionReads.get(pendingKey);
  if (pending) return pending;

  const read = readProjectDependencyVersionsUncoalesced(
    normalized,
    pinningOn,
  )
    .finally(() => {
      if (pendingDependencyVersionReads.get(pendingKey) === read) {
        pendingDependencyVersionReads.delete(pendingKey);
      }
      trimDependencyVersionCache();
    });
  pendingDependencyVersionReads.set(pendingKey, read);
  return read;
}

async function readProjectDependencyVersionsUncoalesced(
  source: NormalizedDependencyPinningSource,
  pinningOn: boolean,
): Promise<DependencyVersionsResult> {
  dependencyVersionReadOperations++;
  const packageJsonPath = source.packageJsonPath!;

  try {
    let statPath: (path: string) => Promise<FileInfo>;
    let readPath: (path: string) => Promise<string>;
    if (source.fs) {
      statPath = (path) => source.fs!.stat(path);
      readPath = (path) => source.fs!.readFile(path);
    } else {
      const { createFileSystem } = await import("../../platform/compat/fs.ts");
      const fs = createFileSystem();
      statPath = (path) => fs.stat(path);
      readPath = (path) => fs.readTextFile(path);
    }

    const beforeStat = await statPath(packageJsonPath);
    let mtimeMs = getMtimeMs(beforeStat.mtime);
    const cached = getDependencyVersionCache(source.cacheIdentity);

    if (
      cached &&
      !pinningOn &&
      mtimeMs !== null &&
      cached.mtimeMs === mtimeMs
    ) {
      return {
        react: cached.react,
        veryfront: cached.veryfront,
        dependencies: undefined,
        dependencyState: "verified",
      };
    }

    let content = await readPath(packageJsonPath);
    // If package.json changes while being read, retry until the bytes are
    // paired with a stable post-read mtime. This avoids caching state A under
    // state B's mtime and then treating the mixed entry as current forever.
    for (let attempt = 0; attempt < 3; attempt++) {
      const afterStat = await statPath(packageJsonPath);
      const afterMtimeMs = getMtimeMs(afterStat.mtime);
      if (mtimeMs === afterMtimeMs) {
        mtimeMs = afterMtimeMs;
        break;
      }
      if (attempt === 2) {
        throw new Error("package.json changed repeatedly while dependency pins were captured");
      }
      mtimeMs = afterMtimeMs;
      content = await readPath(packageJsonPath);
    }

    const deps = parsePackageDependencyMap(content);
    const react = deps.react ? normalizeReactVersion(stripSemverRange(deps.react)) : undefined;
    const veryfront = deps.veryfront ? stripSemverRange(deps.veryfront) : undefined;

    // Only materialize the full dependency map when the pinning flag is on.
    // Flag-off callers only need react/veryfront extraction; building the full
    // map on the default path wastes memory across up to 256 cached projects.
    let dependencies: Record<string, string> | undefined;
    let dependencyPinHash: string | undefined;
    if (pinningOn) {
      dependencies = copyDependencyMap(deps);
      dependencyPinHash = hashDependencyPins(dependencies);
    }

    setDependencyVersionCache(source.cacheIdentity, {
      mtimeMs,
      react,
      veryfront,
      dependencies,
      dependencyPinHash,
    });

    return { react, veryfront, dependencies, dependencyState: "verified" };
  } catch (error) {
    // Never retain transform-affecting pins after the backing package.json
    // disappears or becomes unreadable/malformed. A later valid file will be
    // re-read because there is no stale mtime entry to short-circuit on.
    dependencyVersionCache.delete(source.cacheIdentity);
    currentDependencyPinningKeys.delete(source.cacheIdentity);

    // ENOENT means there is no package.json in the project dir — expected for
    // framework-only environments.  Any other error (permission denied, malformed
    // JSON, etc.) is logged at warn so it is visible without crashing the server.
    const errorRecord = error !== null && typeof error === "object"
      ? error as { code?: unknown; name?: unknown; message?: unknown }
      : undefined;
    const errorMessage = String(errorRecord?.message ?? error);
    const isNotFound = errorRecord?.code === "ENOENT" ||
      errorRecord?.name === "NotFound" ||
      /\b(?:file|path) not found\b/i.test(errorMessage) ||
      /\bno such file or directory\b/i.test(errorMessage);
    if (!isNotFound) {
      logger.warn("Failed to read project dependency versions", {
        packageJsonPath,
        cacheNamespace: source.cacheIdentity,
        error: String(error),
      });
    }
    return { dependencyState: isNotFound ? "absent" : "unknown" };
  }
}

export interface ProjectPackageVersionOptions {
  projectDir?: string | null;
  dependencyPinningSource?: DependencyPinningSourceInput;
  config?: VeryfrontConfig | null;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
}

export interface ResolvedProjectPackageVersions {
  react: string;
  veryfront?: string;
}

function getConfiguredReactVersion(
  config?: VeryfrontConfig | null,
): string | undefined {
  const declaration = getConfiguredReactDeclaration(config);
  return declaration ? normalizeReactVersion(stripSemverRange(declaration)) : undefined;
}

function getConfiguredVeryfrontVersion(
  config?: VeryfrontConfig | null,
): string | undefined {
  const declaration = getConfiguredVeryfrontDeclaration(config);
  return declaration ? stripSemverRange(declaration) : undefined;
}

function getConfiguredReactDeclaration(
  config?: VeryfrontConfig | null,
): string | undefined {
  const publicConfigVersion = config?.react?.version;
  if (publicConfigVersion) return publicConfigVersion;

  const versionsConfig = config?.client?.cdn?.versions;
  return versionsConfig && versionsConfig !== "auto" ? versionsConfig.react : undefined;
}

function getConfiguredVeryfrontDeclaration(
  config?: VeryfrontConfig | null,
): string | undefined {
  const versionsConfig = config?.client?.cdn?.versions;
  return versionsConfig && versionsConfig !== "auto" && versionsConfig.veryfront
    ? versionsConfig.veryfront
    : undefined;
}

function captureConfiguredVersions(
  config?: VeryfrontConfig | null,
): DependencyPinningSnapshot["configuredVersions"] {
  const reactDeclaration = getConfiguredReactDeclaration(config);
  const veryfrontDeclaration = getConfiguredVeryfrontDeclaration(config);
  if (!reactDeclaration && !veryfrontDeclaration) return undefined;

  return {
    ...(reactDeclaration
      ? {
        react: {
          declaration: reactDeclaration,
          effective: normalizeReactVersion(stripSemverRange(reactDeclaration)),
        },
      }
      : {}),
    ...(veryfrontDeclaration
      ? {
        veryfront: {
          declaration: veryfrontDeclaration,
          effective: stripSemverRange(veryfrontDeclaration),
        },
      }
      : {}),
  };
}

function applyConfiguredDependencyOverrides(
  dependencies: Readonly<Record<string, string>>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): Record<string, string> {
  const effective = copyDependencyMap(dependencies);
  if (configuredVersions?.react) {
    effective.react = configuredVersions.react.effective;
  }
  if (configuredVersions?.veryfront) {
    effective.veryfront = configuredVersions.veryfront.effective;
  }
  return effective;
}

function hasEnabledDependencySnapshot(
  options: ProjectPackageVersionOptions,
): boolean {
  return options.dependencyPinningDependencies !== undefined ||
    options.dependencyPinningCacheKey?.startsWith("on:") === true;
}

/**
 * Resolve the package versions that share one runtime/import-map boundary.
 * An enabled snapshot already contains the dependency-affecting config
 * overrides captured with its key, so it wins over current config. Without a
 * snapshot, current config wins over live package.json state.
 */
export async function resolveProjectPackageVersions(
  options: ProjectPackageVersionOptions,
): Promise<ResolvedProjectPackageVersions> {
  if (hasEnabledDependencySnapshot(options)) {
    const dependencies = options.dependencyPinningDependencies;
    return {
      react: dependencies?.react
        ? normalizeReactVersion(stripSemverRange(dependencies.react))
        : DEFAULT_REACT_VERSION,
      veryfront: dependencies?.veryfront ? stripSemverRange(dependencies.veryfront) : undefined,
    };
  }

  const configuredReact = getConfiguredReactVersion(options.config);
  const configuredVeryfront = getConfiguredVeryfrontVersion(options.config);
  let detectedReact: string | undefined;
  let detectedVeryfront: string | undefined;
  if (
    options.projectDir &&
    (configuredReact === undefined || configuredVeryfront === undefined)
  ) {
    const detected = await readProjectDependencyVersions(
      options.dependencyPinningSource ?? options.projectDir,
    );
    detectedReact = detected.react;
    detectedVeryfront = detected.veryfront;
  }

  return {
    react: configuredReact ?? detectedReact ?? DEFAULT_REACT_VERSION,
    veryfront: configuredVeryfront ?? detectedVeryfront,
  };
}

/**
 * Resolve React version for a project with consistent priority:
 * 1. Request-scoped dependency snapshot, including captured config overrides
 * 2. Public config override: config.react.version
 * 3. Legacy CDN config override: config.client.cdn.versions.react
 * 4. package.json detection (via cross-runtime filesystem)
 * 5. DEFAULT_REACT_VERSION fallback
 *
 * This is the single source of truth for React version resolution.
 * Both HTML import map generation and module server transforms should use this.
 */
export async function resolveProjectReactVersion(
  options: ProjectPackageVersionOptions,
): Promise<string> {
  const {
    projectDir,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
  } = options;

  // 1. An enabled request snapshot is authoritative. In particular, do not
  // fall through to the live package.json when the historical map omits React:
  // that would pair state-B React with state-A transforms.
  if (
    dependencyPinningDependencies !== undefined ||
    dependencyPinningCacheKey?.startsWith("on:")
  ) {
    const snapshotReactVersion = dependencyPinningDependencies?.react;
    return normalizeReactVersion(
      snapshotReactVersion ? stripSemverRange(snapshotReactVersion) : undefined,
    );
  }

  // 2-3. Current configuration applies only when there is no immutable snapshot.
  const configuredReactVersion = getConfiguredReactVersion(options.config);
  if (configuredReactVersion) return configuredReactVersion;

  // 4. Detect from package.json
  if (projectDir) {
    const detected = await readProjectDependencyVersions(
      options.dependencyPinningSource ?? projectDir,
    );
    if (detected.react) return detected.react;
  }

  // 5. Fallback to default
  return DEFAULT_REACT_VERSION;
}
