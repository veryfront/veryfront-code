import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { awaitAbortable, throwIfAborted } from "#veryfront/utils/abort.ts";
import { createHash, type Hash } from "node:crypto";
import { createError, toError } from "#veryfront/errors";
import type {
  CacheStats,
  ContentSource,
  DirectoryEntry,
  FSAdapter,
  FSAdapterConfig,
  InvalidationCallbacks,
  ResolvedContentContext,
  StyleCallbacks,
  StylePregenerationFile,
} from "./types.ts";
import type {
  FileInfo,
  ResolveFileOptions,
  SourceSnapshotFingerprintOptions,
  SourceSnapshotFreshnessOptions,
} from "#veryfront/platform/adapters/base.ts";
import type { DependencyMetadataHistory } from "#veryfront/platform/adapters/dependency-metadata-history.ts";
import { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { enablePrivateVeryfrontApiClientSourceContext } from "../../veryfront-api-client/client.ts";
import type { Project } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { StatOperations } from "./stat-operations.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "./cache-keys.ts";
import { isPrefixBeingInvalidated } from "./invalidation-state.ts";
import { WebSocketManager } from "./websocket-manager.ts";
import { admitVerifiedSourceContents } from "./source-content-store.ts";
import {
  fetchSourceListingForContext,
  hasContentContextChanged,
  resolveContentContext,
  summarizeFileList,
  toClientContext,
} from "./adapter-content-context.ts";
import {
  buildFileCacheOptions,
  buildRetryConfig,
  DEFAULT_CACHE_TTL_MS,
  shouldBackgroundPregenerateStyles,
} from "./adapter-helpers.ts";
import { isNotFoundLikeError } from "./read-operations-helpers.ts";
import { DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES } from "../../veryfront-api-transport.ts";
import { requireBoundedFileReadLimit } from "../../bounded-file-read.ts";
import { getCurrentRequestContext } from "./request-context.ts";
import {
  scopeFileListCacheKeyToRequestAuthority,
  scopeToRequestAuthority,
} from "./request-authority.ts";

import {
  clearCachedReleaseAssetManifests,
  registerManifestFetcherForRelease,
  type ReleaseAssetManifestFetcher,
  type ReleaseAssetManifestFetcherCleanup,
} from "#veryfront/release-assets/manifest-cache.ts";

const logger = baseLogger.component("veryfront-fs-adapter");
const BRANCH_MISS_RECOVERY_FAILURE_TTL_MS = 5_000;
const BRANCH_SOURCE_SNAPSHOT_FRESHNESS_MS = 30_000;
const SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS = 32 * 1_024;
const SOURCE_SNAPSHOT_YIELD_CODE_UNITS = 2 * 1_024 * 1_024;
const SOURCE_SNAPSHOT_YIELD_RECORDS = 256;
const SOURCE_SNAPSHOT_DIGEST_BYTES = 32;
/** Pokes naming more reserved data files than this invalidate the whole snapshot. */
const MAX_RESERVED_DATA_POKE_PATHS = 16;
const RESERVED_DATA_PATCH_RETENTION_MS = 10 * 60 * 1_000;
const DateNow = Date.now;
const IntrinsicArrayIsArray = Array.isArray;
const ArrayPrototypeSome = Array.prototype.some;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicPerformance = performance;
const PerformanceNow = IntrinsicPerformance.now;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const IntrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const IntrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const IntrinsicMap = Map;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicPromise = Promise;
const PromiseAll = IntrinsicPromise.all;
const PromisePrototypeCatch = IntrinsicPromise.prototype.catch;
const PromisePrototypeThen = IntrinsicPromise.prototype.then;
const PromiseResolve = IntrinsicPromise.resolve;
const IntrinsicSetTimeout = globalThis.setTimeout;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeStartsWith = String.prototype.startsWith;
const SourceSnapshotHashPrototype = IntrinsicReflectApply(
  IntrinsicObjectGetPrototypeOf,
  Object,
  [createHash("sha256")],
) as Hash;
const HashPrototypeUpdate = SourceSnapshotHashPrototype.update;
const HashPrototypeDigest = SourceSnapshotHashPrototype.digest;
// Process-wide uniqueness prevents a recreated adapter from matching stale
// derived-state generations left behind by its predecessor.
let sourceSnapshotGeneration = 0;

function currentTime(): number {
  return IntrinsicReflectApply(DateNow, Date, []) as number;
}

function performanceNow(): number {
  return IntrinsicReflectApply(PerformanceNow, IntrinsicPerformance, []) as number;
}

function formatDuration(durationMs: number): string {
  return `${IntrinsicReflectApply(NumberPrototypeToFixed, durationMs, [2]) as string}ms`;
}

function ignorePromiseRejection(promise: Promise<unknown>): void {
  void IntrinsicReflectApply(PromisePrototypeCatch, promise, [() => undefined]);
}

function nextSourceSnapshotGeneration(): number {
  if (sourceSnapshotGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Source snapshot generation space is exhausted");
  }
  sourceSnapshotGeneration++;
  return sourceSnapshotGeneration;
}

interface SourceSnapshotFile {
  path: string;
  id?: string;
  version_id?: string;
  content?: string;
  type?: string;
  size?: number;
  updated_at?: string;
}

type SourceSnapshotFileKey = keyof SourceSnapshotFile;
type SourceSnapshotRecord = readonly [
  string | number | null,
  string | number | null,
  string | number | null,
  string | number | null,
  string | number | null,
  string | number | null,
  string | number | null,
];
function getOwnSourceSnapshotValue(
  file: SourceSnapshotFile,
  key: SourceSnapshotFileKey,
): string | number | null {
  const descriptor = IntrinsicReflectApply(
    IntrinsicObjectGetOwnPropertyDescriptor,
    Object,
    [file, key],
  ) as PropertyDescriptor | undefined;
  if (!descriptor || !("value" in descriptor)) return null;
  return typeof descriptor.value === "string" || typeof descriptor.value === "number"
    ? descriptor.value
    : null;
}

function sourceSnapshotsEqual(
  previous: SourceSnapshotFile[] | undefined,
  next: SourceSnapshotFile[],
): boolean {
  if (!previous || previous.length !== next.length) return false;

  const previousByPath = new IntrinsicMap<string, SourceSnapshotFile>();
  for (let index = 0; index < previous.length; index++) {
    const file = previous[index]!;
    const path = getOwnSourceSnapshotValue(file, "path");
    if (typeof path !== "string") return false;
    IntrinsicReflectApply(MapPrototypeSet, previousByPath, [path, file]);
  }
  for (let index = 0; index < next.length; index++) {
    const file = next[index]!;
    const path = getOwnSourceSnapshotValue(file, "path");
    if (typeof path !== "string") return false;
    const prior = IntrinsicReflectApply(MapPrototypeGet, previousByPath, [path]) as
      | SourceSnapshotFile
      | undefined;
    if (
      prior === undefined ||
      getOwnSourceSnapshotValue(prior, "id") !== getOwnSourceSnapshotValue(file, "id") ||
      getOwnSourceSnapshotValue(prior, "version_id") !==
        getOwnSourceSnapshotValue(file, "version_id") ||
      getOwnSourceSnapshotValue(prior, "content") !==
        getOwnSourceSnapshotValue(file, "content") ||
      getOwnSourceSnapshotValue(prior, "type") !== getOwnSourceSnapshotValue(file, "type") ||
      getOwnSourceSnapshotValue(prior, "size") !== getOwnSourceSnapshotValue(file, "size") ||
      getOwnSourceSnapshotValue(prior, "updated_at") !==
        getOwnSourceSnapshotValue(file, "updated_at")
    ) return false;
    IntrinsicReflectApply(MapPrototypeDelete, previousByPath, [path]);
  }
  return true;
}

function captureSourceSnapshotRecord(file: SourceSnapshotFile): SourceSnapshotRecord {
  return [
    getOwnSourceSnapshotValue(file, "path"),
    getOwnSourceSnapshotValue(file, "id"),
    getOwnSourceSnapshotValue(file, "version_id"),
    getOwnSourceSnapshotValue(file, "content"),
    getOwnSourceSnapshotValue(file, "type"),
    getOwnSourceSnapshotValue(file, "size"),
    getOwnSourceSnapshotValue(file, "updated_at"),
  ];
}

interface SourceSnapshotHashBudget {
  codeUnits: number;
}

function yieldSourceSnapshotTask(): Promise<void> {
  return new IntrinsicPromise((resolve) => {
    IntrinsicSetTimeout(resolve, 0);
  });
}

async function continueSourceSnapshotHashString(
  hash: Hash,
  value: string,
  start: number,
  budget: SourceSnapshotHashBudget,
): Promise<void> {
  await yieldSourceSnapshotTask();
  budget.codeUnits = 0;
  for (let chunkStart = start; chunkStart < value.length;) {
    const remaining = value.length - chunkStart;
    const codeUnitCount = SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS < remaining
      ? SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS
      : remaining;
    const bytes = new IntrinsicUint8Array(codeUnitCount * 2);
    for (let offset = 0; offset < codeUnitCount; offset++) {
      const codeUnit = IntrinsicReflectApply(
        StringPrototypeCharCodeAt,
        value,
        [chunkStart + offset],
      ) as number;
      bytes[offset * 2] = codeUnit >>> 8;
      bytes[offset * 2 + 1] = codeUnit & 0xff;
    }
    IntrinsicReflectApply(HashPrototypeUpdate, hash, [bytes]);
    chunkStart += codeUnitCount;
    budget.codeUnits += codeUnitCount;
    if (budget.codeUnits >= SOURCE_SNAPSHOT_YIELD_CODE_UNITS && chunkStart < value.length) {
      await yieldSourceSnapshotTask();
      budget.codeUnits = 0;
    }
  }
}

function updateSourceSnapshotHashString(hash: Hash, value: string): void {
  for (let start = 0; start < value.length; start += SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS) {
    const remaining = value.length - start;
    const codeUnitCount = SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS < remaining
      ? SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS
      : remaining;
    const bytes = new IntrinsicUint8Array(codeUnitCount * 2);
    for (let offset = 0; offset < codeUnitCount; offset++) {
      const codeUnit = IntrinsicReflectApply(
        StringPrototypeCharCodeAt,
        value,
        [start + offset],
      ) as number;
      bytes[offset * 2] = codeUnit >>> 8;
      bytes[offset * 2 + 1] = codeUnit & 0xff;
    }
    IntrinsicReflectApply(HashPrototypeUpdate, hash, [bytes]);
  }
}

function updateSourceSnapshotHashStringBounded(
  hash: Hash,
  value: string,
  budget: SourceSnapshotHashBudget,
): Promise<void> | undefined {
  for (let start = 0; start < value.length; start += SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS) {
    const remaining = value.length - start;
    const codeUnitCount = SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS < remaining
      ? SOURCE_SNAPSHOT_HASH_CHUNK_CODE_UNITS
      : remaining;
    const bytes = new IntrinsicUint8Array(codeUnitCount * 2);
    for (let offset = 0; offset < codeUnitCount; offset++) {
      const codeUnit = IntrinsicReflectApply(
        StringPrototypeCharCodeAt,
        value,
        [start + offset],
      ) as number;
      bytes[offset * 2] = codeUnit >>> 8;
      bytes[offset * 2 + 1] = codeUnit & 0xff;
    }
    IntrinsicReflectApply(HashPrototypeUpdate, hash, [bytes]);
    budget.codeUnits += codeUnitCount;
    if (budget.codeUnits >= SOURCE_SNAPSHOT_YIELD_CODE_UNITS) {
      return continueSourceSnapshotHashString(hash, value, start + codeUnitCount, budget);
    }
  }
  return undefined;
}

function addSourceSnapshotDigest(
  accumulator: Uint8Array,
  digest: Uint8Array,
): void {
  let carry = 0;
  for (let index = SOURCE_SNAPSHOT_DIGEST_BYTES - 1; index >= 0; index--) {
    const sum = accumulator[index]! + digest[index]! + carry;
    accumulator[index] = sum & 0xff;
    carry = sum >>> 8;
  }
}

function normalizeSourceSnapshotRetainPath(path: string): string {
  let normalized = path;
  while (IntrinsicReflectApply(StringPrototypeStartsWith, normalized, ["./"]) === true) {
    normalized = IntrinsicReflectApply(StringPrototypeSlice, normalized, [2]) as string;
  }
  while (IntrinsicReflectApply(StringPrototypeCharCodeAt, normalized, [0]) === 47) {
    normalized = IntrinsicReflectApply(StringPrototypeSlice, normalized, [1]) as string;
  }
  while (
    normalized.length > 0 &&
    IntrinsicReflectApply(StringPrototypeCharCodeAt, normalized, [normalized.length - 1]) === 47
  ) {
    normalized = IntrinsicReflectApply(StringPrototypeSlice, normalized, [0, -1]) as string;
  }
  return normalized === "." ? "" : normalized;
}

function captureSourceSnapshotMarkdownPaths(
  options: SourceSnapshotFingerprintOptions,
  key: "agentMarkdownPaths" | "skillMarkdownPaths",
): string[] {
  const descriptor = IntrinsicReflectApply(
    IntrinsicObjectGetOwnPropertyDescriptor,
    Object,
    [options, key],
  ) as PropertyDescriptor | undefined;
  if (!descriptor || !("value" in descriptor) || !IntrinsicArrayIsArray(descriptor.value)) {
    return [];
  }

  const input = descriptor.value as readonly unknown[];
  const paths: string[] = [];
  for (let index = 0; index < input.length; index++) {
    const item = IntrinsicReflectApply(
      IntrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [input, index],
    ) as PropertyDescriptor | undefined;
    if (!item || !("value" in item) || typeof item.value !== "string") continue;
    paths[paths.length] = normalizeSourceSnapshotRetainPath(item.value);
  }
  return paths;
}

type SourceSnapshotMarkdownPaths = {
  agent: readonly string[];
  skill: readonly string[];
};

function buildSourceSnapshotMarkdownScopeKey(paths: SourceSnapshotMarkdownPaths): string {
  let key = "agent:";
  for (let index = 0; index < paths.agent.length; index++) {
    const path = paths.agent[index]!;
    key += `${path.length}:${path};`;
  }
  key += "skill:";
  for (let index = 0; index < paths.skill.length; index++) {
    const path = paths.skill[index]!;
    key += `${path.length}:${path};`;
  }
  return key;
}

function captureSourceSnapshotMarkdownDiscoveryPaths(
  options: SourceSnapshotFingerprintOptions | undefined,
): SourceSnapshotMarkdownPaths {
  if (options?.purpose !== "agent-config") return { agent: [], skill: [] };
  return {
    agent: captureSourceSnapshotMarkdownPaths(options, "agentMarkdownPaths"),
    skill: captureSourceSnapshotMarkdownPaths(options, "skillMarkdownPaths"),
  };
}

function isSafeDiscoverySegment(value: string): boolean {
  if (value === "" || value === "." || value === "..") return false;
  for (let index = 0; index < value.length; index++) {
    const code = IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
    if (
      (code < 48 || code > 57) &&
      (code < 65 || code > 90) &&
      (code < 97 || code > 122) &&
      code !== 45 &&
      code !== 46 &&
      code !== 95
    ) {
      return false;
    }
  }
  return true;
}

function relativeDiscoveryPath(projectPath: string, root: string): string | undefined {
  if (root === "") return projectPath;
  if (projectPath === root) return "";
  const prefix = `${root}/`;
  return IntrinsicReflectApply(StringPrototypeStartsWith, projectPath, [prefix]) === true
    ? IntrinsicReflectApply(StringPrototypeSlice, projectPath, [prefix.length]) as string
    : undefined;
}

function isAgentMarkdownDefinition(relativePath: string): boolean {
  const segments = IntrinsicReflectApply(StringPrototypeSplit, relativePath, ["/"]) as string[];
  if (segments.length === 1) {
    const fileName = segments[0]!;
    if (
      fileName === "AGENT.md" || fileName === "SKILL.md" ||
      IntrinsicReflectApply(StringPrototypeEndsWith, fileName, [".md"]) !== true
    ) {
      return false;
    }
    return isSafeDiscoverySegment(
      IntrinsicReflectApply(StringPrototypeSlice, fileName, [0, -3]) as string,
    );
  }
  if (!isSafeDiscoverySegment(segments[0]!)) return false;
  return segments.length === 2 && segments[1] === "AGENT.md";
}

function isSkillMarkdownDefinition(relativePath: string): boolean {
  const segments = IntrinsicReflectApply(StringPrototypeSplit, relativePath, ["/"]) as string[];
  return segments.length === 2 && isSafeDiscoverySegment(segments[0]!) &&
    segments[1] === "SKILL.md";
}

function joinDiscoveryPath(root: string, relativePath: string): string {
  return root === "" ? relativePath : `${root}/${relativePath}`;
}

function addActiveSkillDirectory(active: Map<string, true>, path: string): void {
  IntrinsicReflectApply(MapPrototypeSet, active, [path, true]);
}

async function collectActiveSkillDirectories(
  files: SourceSnapshotFile[],
  paths: SourceSnapshotMarkdownPaths,
): Promise<
  {
    fileCount: number;
    projectPaths: Map<number, string>;
    records: Map<number, SourceSnapshotRecord>;
    skillDirectories: Map<string, true>;
  } | undefined
> {
  const seenPaths = new IntrinsicMap<string, true>();
  const projectPaths = new IntrinsicMap<number, string>();
  const records = new IntrinsicMap<number, SourceSnapshotRecord>();
  const fileCount = files.length;
  for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
    const record = captureSourceSnapshotRecord(files[fileIndex]!);
    const path = record[0];
    if (
      typeof path !== "string" ||
      IntrinsicReflectApply(MapPrototypeGet, seenPaths, [path]) === true
    ) {
      return undefined;
    }
    IntrinsicReflectApply(MapPrototypeSet, seenPaths, [path, true]);
    IntrinsicReflectApply(MapPrototypeSet, records, [fileIndex, record]);
    const projectPath = IntrinsicReflectApply(StringPrototypeCharCodeAt, path, [0]) === 47
      ? IntrinsicReflectApply(StringPrototypeSlice, path, [1]) as string
      : path;
    IntrinsicReflectApply(MapPrototypeSet, projectPaths, [fileIndex, projectPath]);
    if ((fileIndex + 1) % SOURCE_SNAPSHOT_YIELD_RECORDS === 0) {
      await yieldSourceSnapshotTask();
    }
  }

  if (paths.agent.length === 0 && paths.skill.length === 0) {
    return {
      fileCount,
      projectPaths,
      records,
      skillDirectories: new IntrinsicMap<string, true>(),
    };
  }

  const agentDirectories = new IntrinsicMap<string, true>();
  for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
    const projectPath = IntrinsicReflectApply(MapPrototypeGet, projectPaths, [fileIndex]) as string;
    for (let rootIndex = 0; rootIndex < paths.agent.length; rootIndex++) {
      const root = paths.agent[rootIndex]!;
      const relativePath = relativeDiscoveryPath(projectPath, root);
      if (relativePath === undefined) continue;
      const segments = IntrinsicReflectApply(StringPrototypeSplit, relativePath, ["/"]) as string[];
      if (
        segments.length === 2 && isSafeDiscoverySegment(segments[0]!) &&
        segments[1] === "AGENT.md"
      ) {
        IntrinsicReflectApply(MapPrototypeSet, agentDirectories, [
          joinDiscoveryPath(root, segments[0]!),
          true,
        ]);
      }
    }
    if ((fileIndex + 1) % SOURCE_SNAPSHOT_YIELD_RECORDS === 0) {
      await yieldSourceSnapshotTask();
    }
  }

  const skillDirectories = new IntrinsicMap<string, true>();
  for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
    const projectPath = IntrinsicReflectApply(MapPrototypeGet, projectPaths, [fileIndex]) as string;
    for (let rootIndex = 0; rootIndex < paths.skill.length; rootIndex++) {
      const root = paths.skill[rootIndex]!;
      const relativePath = relativeDiscoveryPath(projectPath, root);
      if (relativePath === undefined) continue;
      const segments = IntrinsicReflectApply(StringPrototypeSplit, relativePath, ["/"]) as string[];
      if (
        segments.length === 2 && isSafeDiscoverySegment(segments[0]!) &&
        segments[1] === "SKILL.md"
      ) {
        addActiveSkillDirectory(skillDirectories, joinDiscoveryPath(root, segments[0]!));
      }
    }
    for (let rootIndex = 0; rootIndex < paths.agent.length; rootIndex++) {
      const root = paths.agent[rootIndex]!;
      const relativePath = relativeDiscoveryPath(projectPath, root);
      if (relativePath === undefined) continue;
      const segments = IntrinsicReflectApply(StringPrototypeSplit, relativePath, ["/"]) as string[];
      const agentDirectory = segments.length > 0 ? joinDiscoveryPath(root, segments[0]!) : "";
      if (IntrinsicReflectApply(MapPrototypeGet, agentDirectories, [agentDirectory]) !== true) {
        continue;
      }
      if (segments.length === 2 && segments[1] === "SKILL.md") {
        addActiveSkillDirectory(skillDirectories, agentDirectory);
      } else if (
        segments.length === 4 && segments[1] === "skills" &&
        isSafeDiscoverySegment(segments[2]!) && segments[3] === "SKILL.md"
      ) {
        addActiveSkillDirectory(
          skillDirectories,
          joinDiscoveryPath(agentDirectory, `skills/${segments[2]!}`),
        );
      }
    }
    if ((fileIndex + 1) % SOURCE_SNAPSHOT_YIELD_RECORDS === 0) {
      await yieldSourceSnapshotTask();
    }
  }

  return { fileCount, projectPaths, records, skillDirectories };
}

function hasActiveSkillPayloadPrefix(
  projectPath: string,
  marker: string,
  skillDirectories: Map<string, true>,
): boolean {
  let offset = 0;
  while (offset < projectPath.length) {
    const markerIndex = IntrinsicReflectApply(StringPrototypeIndexOf, projectPath, [
      marker,
      offset,
    ]) as number;
    if (markerIndex < 0) return false;
    const skillDirectory = IntrinsicReflectApply(StringPrototypeSlice, projectPath, [
      0,
      markerIndex,
    ]) as string;
    if (IntrinsicReflectApply(MapPrototypeGet, skillDirectories, [skillDirectory]) === true) {
      return true;
    }
    offset = markerIndex + 1;
  }
  return false;
}

function isRuntimeReadableSkillFile(
  projectPath: string,
  skillDirectories: Map<string, true>,
): boolean {
  if (IntrinsicReflectApply(StringPrototypeEndsWith, projectPath, ["/SKILL.md"]) === true) {
    const skillDirectory = IntrinsicReflectApply(StringPrototypeSlice, projectPath, [
      0,
      -9,
    ]) as string;
    if (IntrinsicReflectApply(MapPrototypeGet, skillDirectories, [skillDirectory]) === true) {
      return true;
    }
  }
  return hasActiveSkillPayloadPrefix(projectPath, "/references/", skillDirectories) ||
    hasActiveSkillPayloadPrefix(projectPath, "/resources/", skillDirectories) ||
    hasActiveSkillPayloadPrefix(projectPath, "/assets/", skillDirectories) ||
    hasActiveSkillPayloadPrefix(projectPath, "/scripts/", skillDirectories);
}

function isRetainedMarkdownDefinition(
  projectPath: string,
  paths: SourceSnapshotMarkdownPaths,
): boolean {
  for (let index = 0; index < paths.agent.length; index++) {
    const relativePath = relativeDiscoveryPath(projectPath, paths.agent[index]!);
    if (relativePath !== undefined && isAgentMarkdownDefinition(relativePath)) return true;
  }
  for (let index = 0; index < paths.skill.length; index++) {
    const relativePath = relativeDiscoveryPath(projectPath, paths.skill[index]!);
    if (relativePath !== undefined && isSkillMarkdownDefinition(relativePath)) return true;
  }
  return false;
}

function isKnowledgeMarkdownPath(projectPath: string): boolean {
  return IntrinsicReflectApply(StringPrototypeStartsWith, projectPath, ["knowledge/"]) === true &&
    IntrinsicReflectApply(StringPrototypeEndsWith, projectPath, [".md"]) === true;
}

function isEvalReportPath(projectPath: string): boolean {
  return IntrinsicReflectApply(StringPrototypeStartsWith, projectPath, ["evals/reports/"]) ===
      true &&
    IntrinsicReflectApply(StringPrototypeEndsWith, projectPath, [".json"]) === true;
}

/**
 * Reserved data files: knowledge Markdown and eval reports. Agents and tools
 * write these at run time, so they change far more often than source code.
 */
function isReservedDataPath(projectPath: string): boolean {
  return isKnowledgeMarkdownPath(projectPath) || isEvalReportPath(projectPath);
}

/**
 * Whether `projectPath` is a reserved data file that cannot affect an agent's
 * configuration: neither a Markdown agent or skill definition under the given
 * discovery roots nor a file an active skill reads at run time. The agent-config
 * fingerprint skips these files, and a write to one leaves the source snapshot
 * in place.
 */
function isExcludedAgentConfigDataPath(
  projectPath: string,
  markdownPaths: SourceSnapshotMarkdownPaths,
  skillDirectories: Map<string, true>,
): boolean {
  if (!isReservedDataPath(projectPath)) return false;
  if (isRuntimeReadableSkillFile(projectPath, skillDirectories)) return false;
  return !isKnowledgeMarkdownPath(projectPath) ||
    !isRetainedMarkdownDefinition(projectPath, markdownPaths);
}

/** One reserved data file as the API last reported it; `null` means deleted. */
interface ReservedDataPatch {
  projectPath: string;
  entry: SourceSnapshotFile | null;
}

/**
 * What a reserved-data poke changed. `data`: no changed path can affect an
 * agent configuration. `definition`: a changed path may be a Markdown agent or
 * skill definition, or the discovery roots that decide it are not known.
 */
export type ReservedDataRefreshKind = "data" | "definition";

function toSnapshotProjectPath(file: SourceSnapshotFile): string | undefined {
  const path = getOwnSourceSnapshotValue(file, "path");
  return typeof path === "string" ? normalizeSourceSnapshotRetainPath(path) : undefined;
}

function findReservedDataPatch(
  patches: readonly ReservedDataPatch[],
  projectPath: string,
): ReservedDataPatch | undefined {
  for (let index = 0; index < patches.length; index++) {
    if (patches[index]!.projectPath === projectPath) return patches[index];
  }
  return undefined;
}

/**
 * Copy `files` with each patched path replaced by its new entry, removed when
 * the file was deleted, or appended when the file is new. Unpatched entries
 * keep their identity and order.
 */
function patchSourceSnapshotEntries(
  files: readonly SourceSnapshotFile[],
  patches: readonly ReservedDataPatch[],
): SourceSnapshotFile[] {
  const patched: SourceSnapshotFile[] = [];
  const seen = new IntrinsicMap<string, true>();
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    const projectPath = toSnapshotProjectPath(file);
    const patch = projectPath === undefined
      ? undefined
      : findReservedDataPatch(patches, projectPath);
    if (!patch) {
      patched[patched.length] = file;
      continue;
    }
    if (IntrinsicReflectApply(MapPrototypeGet, seen, [patch.projectPath]) === true) continue;
    IntrinsicReflectApply(MapPrototypeSet, seen, [patch.projectPath, true]);
    if (patch.entry) patched[patched.length] = patch.entry;
  }
  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index]!;
    if (IntrinsicReflectApply(MapPrototypeGet, seen, [patch.projectPath]) === true) continue;
    if (patch.entry) patched[patched.length] = patch.entry;
  }
  return patched;
}

async function computeSourceSnapshotFingerprint(
  files: SourceSnapshotFile[],
  purpose: "complete" | "agent-config",
  markdownPaths: SourceSnapshotMarkdownPaths = { agent: [], skill: [] },
): Promise<string | undefined> {
  // A modular sum of cryptographic per-record digests is independent of list
  // order and keeps the hash accumulator fixed-size. Reject invalid or repeated
  // paths before hashing because filesystem indexing requires one record per path.
  const activeSkills = await collectActiveSkillDirectories(files, markdownPaths);
  if (!activeSkills) return undefined;
  const accumulator = new IntrinsicUint8Array(SOURCE_SNAPSHOT_DIGEST_BYTES);
  const budget: SourceSnapshotHashBudget = { codeUnits: 0 };
  let includedFileCount = 0;
  for (let fileIndex = 0; fileIndex < activeSkills.fileCount; fileIndex++) {
    const record = IntrinsicReflectApply(
      MapPrototypeGet,
      activeSkills.records,
      [fileIndex],
    ) as SourceSnapshotRecord;
    const projectPath = IntrinsicReflectApply(
      MapPrototypeGet,
      activeSkills.projectPaths,
      [fileIndex],
    ) as string;
    if (
      purpose === "agent-config" &&
      isExcludedAgentConfigDataPath(projectPath, markdownPaths, activeSkills.skillDirectories)
    ) {
      if ((fileIndex + 1) % SOURCE_SNAPSHOT_YIELD_RECORDS === 0) {
        await yieldSourceSnapshotTask();
        budget.codeUnits = 0;
      }
      continue;
    }
    includedFileCount++;
    const recordHash = createHash("sha256");
    updateSourceSnapshotHashString(recordHash, "r");
    for (let valueIndex = 0; valueIndex < 7; valueIndex++) {
      const value = record[valueIndex]!;
      if (value === null) {
        const pending = updateSourceSnapshotHashStringBounded(recordHash, "z", budget);
        if (pending) await pending;
        continue;
      }
      const serialized = `${value}`;
      let pending = updateSourceSnapshotHashStringBounded(
        recordHash,
        typeof value === "number" ? "n" : "s",
        budget,
      );
      if (pending) await pending;
      pending = updateSourceSnapshotHashStringBounded(
        recordHash,
        `${serialized.length}:`,
        budget,
      );
      if (pending) await pending;
      pending = updateSourceSnapshotHashStringBounded(recordHash, serialized, budget);
      if (pending) await pending;
    }
    const digest = IntrinsicReflectApply(HashPrototypeDigest, recordHash, []) as Uint8Array;
    addSourceSnapshotDigest(accumulator, digest);
    if ((fileIndex + 1) % SOURCE_SNAPSHOT_YIELD_RECORDS === 0) {
      await yieldSourceSnapshotTask();
      budget.codeUnits = 0;
    }
  }
  await yieldSourceSnapshotTask();
  const fingerprintHash = createHash("sha256");
  updateSourceSnapshotHashString(
    fingerprintHash,
    purpose === "agent-config"
      ? "veryfront-agent-config-snapshot-multiset-v1"
      : "veryfront-source-snapshot-multiset-v1",
  );
  updateSourceSnapshotHashString(fingerprintHash, `${includedFileCount}:`);
  IntrinsicReflectApply(HashPrototypeUpdate, fingerprintHash, [accumulator]);
  return IntrinsicReflectApply(HashPrototypeDigest, fingerprintHash, ["hex"]) as string;
}

interface BranchSnapshotRecoveryOptions<T> {
  isRecoverableMissResult?: (result: T) => boolean;
  requirePendingSourceInvalidation?: boolean;
}

/**
 * Build a project-scoped manifest fetcher backed by the given API client.
 *
 * The fetcher resolves a manifest for a specific release via the GET endpoint.
 * Registered per-releaseId in `setContentContext` so each releaseId is always
 * served by the client (and token) that owns it.
 */
function buildManifestFetcher(
  client: VeryfrontApiClient,
): ReleaseAssetManifestFetcher {
  return (releaseId: string, context) =>
    client.getReleaseAssetManifest(releaseId, undefined, context.signal);
}

export class VeryfrontFSAdapter implements FSAdapter {
  readonly sourceSnapshotFreshnessOptionsVersion = 1 as const;
  readonly maxWholeFileReadBytes = DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES;
  readonly symlinkSemantics = "none" as const;
  readonly projectContextSemantics: "fixed" | undefined;
  private client: VeryfrontApiClient;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationGeneration = 0;
  private exactReadInitializationPromise: Promise<void> | null = null;
  private exactReadInitializationGeneration = 0;

  /** Resolves when file list initialization is complete (for coordinating reads) */
  private fileListReadyResolve: (() => void) | null = null;
  /** Single-flight background rewarm when the file list cache disappears */
  // Resolves with the files it fetched, so a caller that waited does not have
  // to depend on the cache write having succeeded -- writes are skipped
  // entirely when caching is disabled, and can fail on a backend cache.
  private fileListWarmupPromise: Promise<Array<{ path: string; content?: string }> | null> | null =
    null;
  private fileListWarmupKey: string | null = null;
  /**
   * Last listing this adapter fetched or was poked with, kept in memory because
   * a cache write is not guaranteed to retain it: writes are skipped entirely
   * when caching is disabled, oversized listings are dropped by the memory
   * cache, and backend writes can fail. Without this, every module lookup of a
   * render would miss the cache and await its own full listing fetch -- more
   * API traffic than the per-file probing this replaced. It expires with the
   * same TTL as the cache entry it stands in for and is dropped by every
   * invalidation, so it is never fresher or staler than a retained cache write.
   */
  private retainedFileList:
    | {
      cacheKey: string;
      files: Array<{ path: string; content?: string }>;
      snapshotVersion: number;
      retainedAt: number;
    }
    | null = null;
  private readonly fileListRetentionMs: number;
  /** Single-flight foreground refresh when a branch preview read misses a newly pushed file. */
  private readonly branchMissRecoveryPromises = new Map<string, Promise<void>>();
  private readonly branchMissRecoveryFailures = new Map<string, number>();
  /** Last successful source check and generation of the materialized snapshot. */
  private sourceSnapshotCheckedAt = 0;
  private sourceSnapshotVersion = nextSourceSnapshotGeneration();
  private sourceSnapshotIdentity: string | undefined;
  private sourceSnapshotFiles: SourceSnapshotFile[] | undefined;
  private hasAppliedSourceSnapshot = false;
  private sourceSnapshotFingerprint:
    | { version: number; value: Promise<string | undefined> }
    | undefined;
  private agentConfigSourceSnapshotFingerprint:
    | { version: number; value: Promise<string | undefined> }
    | undefined;
  private scopedAgentConfigSourceSnapshotFingerprint:
    | { version: number; scopeKey: string; value: Promise<string | undefined> }
    | undefined;
  private sourceSnapshotRefreshPromise: Promise<void> | null = null;
  /**
   * Markdown discovery roots from the latest discovery-aware agent-config
   * fingerprint. They decide whether a knowledge Markdown write can change an
   * agent definition; unknown roots treat every such write as one that can.
   */
  #agentMarkdownDiscoveryPaths: SourceSnapshotMarkdownPaths | undefined;
  /** Advances each time reserved data files are patched into the snapshot. */
  #reservedDataGeneration = 0;
  /** Generation and time at which each reserved data path was last patched. */
  readonly #reservedDataPatches = new IntrinsicMap<
    string,
    { generation: number; patchedAt: number }
  >();
  /** Newest refresh requested per reserved data path, so older replies stand down. */
  #reservedDataRequestSequence = 0;
  readonly #reservedDataLatestRequests = new IntrinsicMap<string, number>();
  private sourceSnapshotMutationTail: Promise<void> = IntrinsicReflectApply(
    PromiseResolve,
    IntrinsicPromise,
    [],
  ) as Promise<void>;

  private projectData?: Project;
  private apiBaseUrl: string;
  private apiToken: string;
  private activeRequestToken: string;
  private projectSlug: string;
  private invalidationCallbacks: InvalidationCallbacks;
  private styleCallbacks: StyleCallbacks;
  private wsManager: WebSocketManager;
  private manifestFetcherCleanup: ReleaseAssetManifestFetcherCleanup | null = null;

  /** Per-request branch override (for branch preview URLs) */
  private requestBranch: string | null = null;

  /** Content source configuration from config */
  private contentSource: ContentSource;
  /** Resolved content context after initialization (includes resolved releaseId for env/domain) */
  private contentContext: ResolvedContentContext | null = null;
  /** Whether running in proxy mode (shared adapter with per-request OAuth tokens) */
  private proxyMode: boolean;

  private getEffectiveContentContext(): ResolvedContentContext | null {
    const context = this.contentContext;
    if (context?.sourceType !== "branch") return context;
    const requestContext = getCurrentRequestContext();
    const branch = requestContext ? requestContext.branch : this.requestBranch;
    return branch ? { ...context, branch } : context;
  }

  private getCurrentFileListCacheKey(): string | undefined {
    const context = this.getEffectiveContentContext();
    if (!context) return undefined;
    return scopeFileListCacheKeyToRequestAuthority(buildFileListCacheKey(context));
  }

  #getSourceSnapshotIdentity(context: ResolvedContentContext): string {
    switch (context.sourceType) {
      case "branch":
        return `branch:${context.projectSlug}:${context.branch ?? "main"}`;
      case "environment":
        return `environment:${context.projectSlug}:${context.environmentName ?? ""}:${
          context.releaseId ?? ""
        }`;
      case "release":
        return `release:${context.projectSlug}:${context.releaseId ?? ""}`;
    }
  }

  #getCurrentSourceSnapshotIdentity(): string | undefined {
    const context = this.getEffectiveContentContext();
    if (!context) return undefined;
    return this.#getSourceSnapshotIdentity(context);
  }

  /** Names a source across credentials for content reuse; never authorizes. */
  #getSourceContentKey(context: ResolvedContentContext): string {
    return `${this.apiBaseUrl}|${this.#getSourceSnapshotIdentity(context)}`;
  }

  #fetchSourceListing(context: ResolvedContentContext): ReturnType<
    typeof fetchSourceListingForContext
  > {
    return fetchSourceListingForContext(this.client, context, this.#getSourceContentKey(context));
  }

  /**
   * Publish a fetched listing to the credential-scoped listing cache. A listing
   * assembled from verified contents is not copied into a distributed cache:
   * another adapter can assemble it just as cheaply, and uploading a complete
   * project on every fresh credential costs more than it saves. The retained
   * listing answers this adapter's reads instead.
   */
  async #storeFileList(
    cacheKey: string,
    listing: { files: Array<{ path: string; content?: string }>; contentReused: boolean },
  ): Promise<void> {
    if (listing.contentReused && this.cache.isDistributed()) return;
    await this.cache.setAsync(cacheKey, listing.files);
  }

  private syncClientContext(): void {
    this.client.clearRequestBranch();

    if (this.contentContext) {
      this.client.setContext(toClientContext(this.contentContext));
    } else {
      this.client.clearContext();
    }

    if (this.requestBranch) {
      this.client.setRequestBranch(this.requestBranch);
    }
  }

  private getCachedFileListSync<T extends { path: string; id?: string }>(): T[] | undefined {
    const cacheKey = this.getCurrentFileListCacheKey();
    if (!cacheKey) return undefined;
    return this.cache.get(cacheKey) as T[] | undefined;
  }

  private async getCachedFileListAsync<T extends { path: string }>(
    noContextMessage: string,
    lookupLabel: string,
    missReason: string,
    options: {
      waitForWarmup?: boolean;
      cacheKey?: string;
      contentContext?: ResolvedContentContext | null;
    } = {},
  ): Promise<{ cacheKey: string; files: T[] | undefined } | undefined> {
    // Capture the context and its cache key as one pair, before the awaited
    // cache read below. Leaving the warmup to re-read the context afterwards
    // let a `setRequestBranch` landing during that read pair branch B's
    // listing with branch A's key: the warmup fetched B and wrote it under A.
    const effectiveContext = options.contentContext ?? this.getEffectiveContentContext();
    const cacheKey = options.cacheKey ??
      (effectiveContext
        ? scopeFileListCacheKeyToRequestAuthority(buildFileListCacheKey(effectiveContext))
        : undefined);
    if (!cacheKey) {
      logger.debug(noContextMessage);
      return undefined;
    }

    // The retained listing is what this adapter last fetched or was poked
    // with for this key, and every write this adapter makes to the key
    // retains it too, so it answers before the cache round trip. Every
    // invalidation drops it, and a listing for another key is left untouched.
    let files = this.retainedFileList?.cacheKey === cacheKey
      ? this.readRetainedFileList<T>(cacheKey)
      : undefined;
    files ??= await this.cache.getAsync<T[]>(cacheKey);
    logger.debug(`${lookupLabel} lookup`, {
      cacheKey,
      hasResult: !!files,
      resultSize: files?.length ?? 0,
      hasContent: (files as Array<{ content?: string }> | undefined)?.filter((file) =>
        !!file.content
      )?.length ?? 0,
    });

    if (files === undefined) {
      files = this.readRetainedFileList<T>(cacheKey);
    }

    if (files === undefined) {
      this.scheduleFileListWarmup(missReason, cacheKey, effectiveContext);
      if (options.waitForWarmup) {
        files = await this.awaitFileListWarmup<T>(cacheKey) ?? files;
      }
    }

    return { cacheKey, files };
  }

  /** Keep `files` answerable from memory for as long as a cache write would. */
  private retainFileList(
    cacheKey: string,
    files: Array<{ path: string; content?: string }>,
  ): void {
    this.retainedFileList = {
      cacheKey,
      files,
      snapshotVersion: this.sourceSnapshotVersion,
      retainedAt: currentTime(),
    };
  }

  private clearRetainedFileList(): void {
    this.retainedFileList = null;
  }

  /**
   * The retained listing, if it still describes the snapshot the caller is
   * reading. Anything that supersedes the snapshot -- a poke, a refresh, a
   * branch or token change -- either drops it outright or moves the snapshot
   * version past it, so a superseded listing can never answer a read.
   */
  private readRetainedFileList<T extends { path: string }>(
    cacheKey: string,
  ): T[] | undefined {
    const retained = this.retainedFileList;
    if (!retained) return undefined;

    if (
      retained.cacheKey !== cacheKey ||
      retained.snapshotVersion !== this.sourceSnapshotVersion
    ) {
      this.clearRetainedFileList();
      return undefined;
    }

    if (currentTime() - retained.retainedAt > this.fileListRetentionMs) {
      logger.debug("Retained file list expired", { cacheKey });
      this.clearRetainedFileList();
      return undefined;
    }

    return retained.files as T[];
  }

  /**
   * Wait for the in-flight file-list warmup for `cacheKey` and return the
   * fetched listing. SSR module resolution reads this list for every module of
   * a page; when the cached listing has expired, answering "no list" makes each
   * module fall back to its own per-file/per-extension API probing (dozens of
   * sequential fetches per render). Paying for one awaited listing fetch keeps
   * that fan-out at a single API call while staying exactly as fresh: the
   * listing is fetched from the API at request time. Warmup failures resolve to
   * undefined so callers keep the legacy per-file fallback.
   */
  private async awaitFileListWarmup<T extends { path: string }>(
    cacheKey: string,
  ): Promise<T[] | undefined> {
    const warmupPromise = this.fileListWarmupPromise;
    if (!warmupPromise || this.fileListWarmupKey !== cacheKey) return undefined;

    const fetched = await warmupPromise;
    return fetched === null ? undefined : (fetched as T[]);
  }

  constructor(config: FSAdapterConfig) {
    this.invalidationCallbacks = config.invalidationCallbacks ?? {};
    this.styleCallbacks = config.styleCallbacks ?? {};
    const vf = config.veryfront;
    if (!vf) {
      throw toError(
        createError({
          type: "config",
          message: "Veryfront adapter requires veryfront configuration",
        }),
      );
    }

    this.apiBaseUrl = vf.apiBaseUrl ?? "";
    this.apiToken = vf.apiToken ?? "";
    this.activeRequestToken = this.apiToken;
    this.projectSlug = vf.projectSlug ?? "";
    this.contentSource = vf.contentSource ?? { type: "branch", branch: "main" };
    this.proxyMode = vf.proxyMode ?? false;
    this.projectContextSemantics = this.proxyMode ? undefined : "fixed";

    const retryConfig = buildRetryConfig(vf.retry);

    this.client = new VeryfrontApiClient({
      apiBaseUrl: this.apiBaseUrl,
      apiToken: this.apiToken,
      projectSlug: this.projectSlug,
      projectId: vf.projectId,
      proxyMode: vf.proxyMode,
      retry: retryConfig,
    });
    enablePrivateVeryfrontApiClientSourceContext(this.client);
    this.client.enableContextualToken();

    const cacheConfig = buildFileCacheOptions(vf.cache);

    this.cache = new FileCache(cacheConfig);
    this.fileListRetentionMs = cacheConfig.ttl ?? DEFAULT_CACHE_TTL_MS;
    this.normalizer = new PathNormalizer(config.projectDir);
    // Per-releaseId fetcher registration is done in setContentContext when a
    // release context is resolved, ensuring the correct project-scoped token.

    const contentContextGetter = {
      isProductionMode: () => this.contentContext?.sourceType !== "branch",
      getReleaseId: () => this.contentContext?.releaseId ?? null,
      getContentContext: () => this.getEffectiveContentContext(),
      getFileList: async (requestedContext?: ResolvedContentContext | null) => {
        const cached = await this.getCachedFileListAsync<{
          id?: string;
          path: string;
          content?: string;
          type?: string;
          size?: number;
          updated_at?: string;
        }>("getFileList: no contentContext", "getFileList", "getFileList miss", {
          waitForWarmup: true,
          cacheKey: requestedContext
            ? scopeFileListCacheKeyToRequestAuthority(buildFileListCacheKey(requestedContext))
            : undefined,
          contentContext: requestedContext,
        });
        return cached?.files;
      },
      hasCachedFileList: async () => {
        const cached = await this.getCachedFileListAsync<{ path: string }>(
          "hasCachedFileList: no contentContext",
          "hasCachedFileList",
          "hasCachedFileList miss",
          { waitForWarmup: true },
        );
        return Array.isArray(cached?.files);
      },
      getSourceSnapshotVersion: () => this.sourceSnapshotVersion,
      getSourceSnapshotIdentity: () => this.#getCurrentSourceSnapshotIdentity(),
      isPersistentCacheInvalidated: (prefix: string) => this.#isPersistentCacheInvalidated(prefix),
      isReleaseBeingInvalidated: (releaseId: string) =>
        this.#isPersistentCacheInvalidated(
          buildFileCacheKeyPrefix({
            sourceType: "release",
            projectSlug: this.projectSlug,
            releaseId,
          }),
        ),
    };

    this.statOps = new StatOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
    );

    this.readOps = new ReadOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
      (path) => this.statOps.getOriginalApiPath(path),
      async (cacheKey, contentContext) => {
        const cached = await this.getCachedFileListAsync<{ path: string; content?: string }>(
          "getFileListCache: no contentContext",
          "getFileListCache",
          "getFileListCache miss",
          { waitForWarmup: true, cacheKey, contentContext },
        );
        return cached?.files;
      },
      () => this.sourceSnapshotVersion,
    );

    this.dirOps = new DirectoryOperations(
      this.client,
      this.cache,
      this.normalizer,
      contentContextGetter,
    );

    this.wsManager = new WebSocketManager({
      apiBaseUrl: this.apiBaseUrl,
      apiToken: this.apiToken,
      projectSlug: this.projectSlug,
      cache: this.cache,
      client: this.client,
      invalidationCallbacks: this.invalidationCallbacks,
      getContentContext: () => this.contentContext,
      getEffectiveContentContext: () => this.getEffectiveContentContext(),
      getContentSource: () => this.contentSource,
      getProjectDir: () => this.normalizer.getProjectDir(),
      clearMemoryCaches: () => this.clearMemoryCaches(),
      getFileListCacheKey: () => this.getCurrentFileListCacheKey(),
      getSourceSnapshotVersion: () => this.sourceSnapshotVersion,
      replaceSourceSnapshot: (cacheKey, files, expectedSnapshotVersion, expectedDataGeneration) =>
        this.replaceSourceSnapshot(
          cacheKey,
          files,
          expectedSnapshotVersion,
          expectedDataGeneration,
        ),
      getReservedDataGeneration: () => this.#reservedDataGeneration,
      canPatchReservedDataPaths: (changedPaths) => this.canPatchReservedDataPaths(changedPaths),
      refreshReservedDataPaths: (changedPaths) => this.refreshReservedDataPaths(changedPaths),
      pregenerateStyles: (files) => this.triggerCSSPregeneration(files),
    });

    logger.debug("Created", {
      apiBaseUrl: this.apiBaseUrl,
      projectSlug: this.projectSlug,
      projectDir: config.projectDir,
      contentSource: this.contentSource,
      cacheEnabled: cacheConfig.enabled,
    });
  }

  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    const initialization = this.#performInitialization();
    const initializationGeneration = ++this.initializationGeneration;
    this.initializationPromise = initialization;
    try {
      await initialization;
    } finally {
      if (this.initializationGeneration === initializationGeneration) {
        this.initializationPromise = null;
      }
    }
  }

  async #performInitialization(): Promise<void> {
    const initStartTime = performanceNow();
    const projectSlug = this.client.getProjectSlug();

    logger.debug("initialize START", {
      projectSlug,
      contentSource: this.contentSource,
      alreadyInitialized: this.initialized,
    });

    if (this.initialized) {
      logger.debug("Already initialized, skipping", { projectSlug });
      return;
    }

    const fileListReadyPromise = new IntrinsicPromise<void>((resolve) => {
      this.fileListReadyResolve = resolve;
    });
    this.readOps.setFileListReadyPromise(fileListReadyPromise);

    logger.debug("Step 1: client.initialize START", { projectSlug });
    const step1Start = performanceNow();
    await this.client.initialize();
    logger.debug("Step 1: client.initialize DONE", {
      projectSlug,
      duration: formatDuration(performanceNow() - step1Start),
    });

    const projectId = this.client.getProjectId();
    logger.debug("Step 2: getProject START", { projectSlug, projectId });
    const step2Start = performanceNow();

    const cachedProject = this.client.getCachedProject();
    this.projectData = cachedProject ?? (await this.client.getProject(projectId));

    logger.debug(
      `[VeryfrontFSAdapter] Step 2: getProject DONE (${cachedProject ? "from cache" : "from API"})`,
      {
        projectSlug,
        provider: this.projectData.provider,
        layout: this.projectData.layout,
        duration: formatDuration(performanceNow() - step2Start),
      },
    );

    if (!this.contentContext) {
      logger.debug("Step 3: resolveContentSource START", { projectSlug });
      const step3Start = performanceNow();
      const resolvedContext = await resolveContentContext(
        this.client,
        this.contentSource,
        this.projectSlug,
      );
      this.setContentContext(resolvedContext);
      logger.debug("Step 3: resolveContentSource DONE", {
        projectSlug,
        sourceType: resolvedContext.sourceType,
        duration: formatDuration(performanceNow() - step3Start),
      });
    } else {
      logger.debug("Step 3: Content context already set", {
        projectSlug,
        sourceType: this.contentContext.sourceType,
      });
    }

    const contentContext = this.contentContext;
    if (!contentContext) {
      throw toError(
        createError({
          type: "config",
          message: "Veryfront adapter content context resolution failed",
        }),
      );
    }

    logger.debug("Content context resolved", {
      sourceType: contentContext.sourceType,
      projectSlug: contentContext.projectSlug,
      branch: contentContext.branch,
      environmentName: contentContext.environmentName,
      releaseId: contentContext.releaseId,
    });

    const initializationContext = this.getEffectiveContentContext() ?? contentContext;
    const cacheKey = scopeFileListCacheKeyToRequestAuthority(
      buildFileListCacheKey(initializationContext),
    );
    const initializationIdentity = this.#getCurrentSourceSnapshotIdentity();
    const initializationSnapshotVersion = this.sourceSnapshotVersion;
    const initializationDataGeneration = this.#reservedDataGeneration;
    logger.debug("Step 4: fetchFileList START", { projectSlug, cacheKey });

    try {
      const fetchedListing = await this.#fetchSourceListing(initializationContext);
      let files = fetchedListing.files;
      const fileSummary = summarizeFileList(files);

      const initialSnapshotApplied = await this.#runSourceSnapshotMutation(async () => {
        const isSnapshotSuperseded = () =>
          this.contentContext !== contentContext ||
          this.#getCurrentSourceSnapshotIdentity() !== initializationIdentity ||
          this.sourceSnapshotVersion !== initializationSnapshotVersion;
        if (isSnapshotSuperseded()) return false;

        files = this.#overlayReservedDataPatches(files, initializationDataGeneration);
        const listing = { ...fetchedListing, files };
        await this.#storeFileList(cacheKey, listing);
        if (isSnapshotSuperseded()) {
          await this.cache.deleteAsync(cacheKey);
          return false;
        }

        this.markSourceSnapshotChanged(files, initializationIdentity);
        // Retain after the generation bump so the first read can reuse the
        // initialized snapshot even when the configured cache keeps nothing.
        this.retainFileList(cacheKey, files);
        return true;
      });

      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;

      logger.debug(
        initialSnapshotApplied
          ? "Fetched files during initialization"
          : "Discarded initialization files superseded by a newer source snapshot",
        {
          cacheKey,
          totalFiles: fileSummary.totalFiles,
          filesWithContent: fileSummary.filesWithContent,
          sourceFiles: fileSummary.sourceFiles,
          sourceFilesWithContent: fileSummary.sourceFilesWithContent,
        },
      );

      // Trigger CSS pre-generation after the initial file snapshot is ready for
      // published contexts. Branch previews should first try remote metadata
      // recovery on cold starts instead of repopulating the prepared cache here.
      if (
        initialSnapshotApplied &&
        fileSummary.sourceFilesWithContent > 0 &&
        this.shouldBackgroundPregenerateStyles()
      ) {
        ignorePromiseRejection(this.triggerCSSPregeneration(files));
      }

      this.initialized = true;

      logger.debug("initialize COMPLETE", {
        projectSlug,
        fileCount: initialSnapshotApplied ? files.length : 0,
        totalDuration: formatDuration(performanceNow() - initStartTime),
      });

      const initializedContext = this.contentContext;
      if (initializedContext?.sourceType === "branch") {
        logger.debug("Initialized (branch mode)", {
          projectId: this.client.getProjectId(),
          files: initialSnapshotApplied ? files.length : 0,
          branch: initializedContext.branch,
          proxyMode: this.proxyMode,
        });
        this.wsManager.connect(projectId);
        return;
      }

      logger.debug("Initialized (published mode)", {
        projectId: this.client.getProjectId(),
        files: initialSnapshotApplied ? files.length : 0,
        sourceType: initializedContext?.sourceType,
        environmentName: initializedContext?.environmentName,
        releaseId: initializedContext?.releaseId,
      });

      // Keep a WebSocket connection in environment mode to receive deployment pokes.
      // Release mode is immutable, so no need to keep a live connection.
      if (initializedContext?.sourceType === "environment") {
        this.wsManager.connect(projectId);
      }
    } catch (error) {
      // Resolve (not reject) to avoid an unhandled-rejection crash in Deno when no lookup() is awaiting.
      this.fileListReadyResolve?.();
      this.fileListReadyResolve = null;
      throw error;
    }
  }

  #isPersistentCacheInvalidated(prefix: string): boolean {
    return isPrefixBeingInvalidated(prefix);
  }

  private shouldBackgroundPregenerateStyles(): boolean {
    // Branch previews should recover the last registered stylesheet artifact on
    // cold starts before rebuilding CSS locally. Live edit pokes still
    // pregenerate through the WebSocket path after branch content changes.
    return shouldBackgroundPregenerateStyles(this.contentContext);
  }

  #getBranchMissRecoveryScope(): string {
    const snapshotIdentity = this.#getCurrentSourceSnapshotIdentity() ??
      `branch:${this.projectSlug}:${this.contentContext?.branch ?? "main"}`;
    return scopeToRequestAuthority(snapshotIdentity);
  }

  #getBranchMissRecoveryKeyPrefix(scope = this.#getBranchMissRecoveryScope()): string {
    return `${scope.length}:${scope}:`;
  }

  #getBranchMissRecoveryKey(path: string): string {
    const normalizedPath = this.normalizer.normalize(path);
    return `${this.#getBranchMissRecoveryKeyPrefix()}${normalizedPath}`;
  }

  #hasRecentBranchMissRecoveryFailure(key: string): boolean {
    const failedAt = this.branchMissRecoveryFailures.get(key);
    if (!failedAt) return false;

    if (currentTime() - failedAt < BRANCH_MISS_RECOVERY_FAILURE_TTL_MS) return true;

    this.branchMissRecoveryFailures.delete(key);
    return false;
  }

  #shouldRecoverBranchMiss(path: string, error: unknown): boolean {
    if (this.contentContext?.sourceType !== "branch") return false;
    if (!isNotFoundLikeError(error)) return false;
    // Hosted config tries several root candidates. An absent candidate in the
    // current complete listing needs no second branch listing. Other files
    // still recover immediately because they may have just been written.
    const normalizedPath = this.normalizer.normalize(path);
    const context = this.getEffectiveContentContext();
    const snapshotAge = currentTime() - this.sourceSnapshotCheckedAt;
    if (
      IntrinsicReflectApply(ArrayPrototypeSome, VERYFRONT_CONFIG_FILES, [
        (candidate: string) => candidate === normalizedPath,
      ]) &&
      this.sourceSnapshotIdentity === this.#getCurrentSourceSnapshotIdentity() &&
      snapshotAge >= 0 && snapshotAge < BRANCH_SOURCE_SNAPSHOT_FRESHNESS_MS &&
      context && !this.#isPersistentCacheInvalidated(buildFileCacheKeyPrefix(context))
    ) {
      const cacheKey = this.getCurrentFileListCacheKey();
      const files = cacheKey ? this.readRetainedFileList(cacheKey) : undefined;
      if (
        files && !IntrinsicReflectApply(ArrayPrototypeSome, files, [
          (file: { path: string }) => file.path === normalizedPath,
        ])
      ) return false;
    }
    // The index was built from a listing already fetched for this snapshot, and
    // it says the path is absent. Recovering here re-derives that answer per
    // probe, so a page trying N candidate spellings pays N recoveries to be
    // told the same thing N times — which is the fan-out this fixes.
    //
    // Two things bound the staleness this trades for. A poke clears the index
    // (see the invalidation path below), so an edit that reaches us re-enables
    // recovery immediately. And `isIndexAuthoritative` is time-boxed by
    // INDEX_AUTHORITY_LIMIT_MS, so an edit whose poke we MISS costs at most
    // that window before recovery turns back on by itself.
    if (this.statOps.isIndexAuthoritative()) return false;

    const recoveryKey = this.#getBranchMissRecoveryKey(path);
    return !this.#hasRecentBranchMissRecoveryFailure(recoveryKey);
  }

  #shouldRecoverBranchMissResult<T>(
    path: string,
    result: T,
    options?: BranchSnapshotRecoveryOptions<T>,
  ): boolean {
    if (this.contentContext?.sourceType !== "branch") return false;
    if (!options?.isRecoverableMissResult?.(result)) return false;
    if (
      options.requirePendingSourceInvalidation &&
      !this.#isPersistentCacheInvalidated(
        buildFileCacheKeyPrefix(this.getEffectiveContentContext()),
      )
    ) {
      return false;
    }

    const recoveryKey = this.#getBranchMissRecoveryKey(path);
    return !this.#hasRecentBranchMissRecoveryFailure(recoveryKey);
  }

  async #refreshBranchSnapshotAfterMiss(path: string): Promise<void> {
    const recoveryScope = this.#getBranchMissRecoveryScope();
    let recoveryPromise = this.branchMissRecoveryPromises.get(recoveryScope);

    if (!recoveryPromise) {
      const normalizedPath = this.normalizer.normalize(path);
      recoveryPromise = this.#refreshSourceSnapshot(`branch-miss:${normalizedPath}`);
      this.branchMissRecoveryPromises.set(recoveryScope, recoveryPromise);
    }

    try {
      await recoveryPromise;
    } finally {
      if (this.branchMissRecoveryPromises.get(recoveryScope) === recoveryPromise) {
        this.branchMissRecoveryPromises.delete(recoveryScope);
      }
    }
  }

  async #withBranchSnapshotRecovery<T>(
    path: string,
    operation: () => Promise<T>,
    options?: BranchSnapshotRecoveryOptions<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      if (!this.#shouldRecoverBranchMissResult(path, result, options)) return result;

      const recoveryKey = this.#getBranchMissRecoveryKey(path);
      try {
        await this.#refreshBranchSnapshotAfterMiss(path);
      } catch (refreshError) {
        this.branchMissRecoveryFailures.set(recoveryKey, currentTime());
        logger.warn("Branch snapshot recovery failed after result miss", {
          path: this.normalizer.normalize(path),
          projectSlug: this.projectSlug,
          branch: this.requestBranch ?? this.contentContext?.branch,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
        return result;
      }

      const retryResult = await operation();
      if (options?.isRecoverableMissResult?.(retryResult)) {
        this.branchMissRecoveryFailures.set(recoveryKey, currentTime());
      }
      return retryResult;
    } catch (error) {
      if (!this.#shouldRecoverBranchMiss(path, error)) throw error;

      const recoveryKey = this.#getBranchMissRecoveryKey(path);
      try {
        await this.#refreshBranchSnapshotAfterMiss(path);
      } catch (refreshError) {
        this.branchMissRecoveryFailures.set(recoveryKey, currentTime());
        logger.warn("Branch snapshot recovery failed after not-found miss", {
          path: this.normalizer.normalize(path),
          projectSlug: this.projectSlug,
          branch: this.requestBranch ?? this.contentContext?.branch,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
        throw error;
      }

      try {
        return await operation();
      } catch (retryError) {
        if (isNotFoundLikeError(retryError)) {
          this.branchMissRecoveryFailures.set(recoveryKey, currentTime());
        }
        throw retryError;
      }
    }
  }

  private scheduleFileListWarmup(
    reason: string,
    cacheKey?: string,
    contentContext?: ResolvedContentContext | null,
  ): void {
    if (!this.initialized || !this.contentContext) return;

    const effectiveCacheKey = cacheKey ?? this.getCurrentFileListCacheKey()!;

    if (this.fileListWarmupPromise && this.fileListWarmupKey === effectiveCacheKey) {
      logger.debug("File list warmup already in progress", {
        reason,
        cacheKey: effectiveCacheKey,
      });
      return;
    }

    const warmupBaseContext = this.contentContext;
    const warmupContext = contentContext ?? this.getEffectiveContentContext();
    if (!warmupContext) return;
    const warmupIdentity = this.#getSourceSnapshotIdentity(warmupContext);
    const warmupSnapshotVersion = this.sourceSnapshotVersion;
    const warmupDataGeneration = this.#reservedDataGeneration;
    let warmupPromise: Promise<Array<{ path: string; content?: string }> | null> | null = null;
    warmupPromise = (async () => {
      try {
        const existing = await this.cache.getAsync<Array<{ path: string; content?: string }>>(
          effectiveCacheKey,
        );

        if (existing !== undefined) {
          logger.debug("Skipping file list warmup because cache is already populated", {
            reason,
            cacheKey: effectiveCacheKey,
            fileCount: existing.length,
          });
          return existing;
        }

        logger.debug("Starting file list warmup", {
          reason,
          cacheKey: effectiveCacheKey,
          sourceType: warmupContext.sourceType,
          branch: warmupContext.branch,
          environmentName: warmupContext.environmentName,
          releaseId: warmupContext.releaseId,
        });

        const fetchedListing = await this.#fetchSourceListing(warmupContext);
        let files = fetchedListing.files;
        let listing = fetchedListing;

        // A WebSocket snapshot can land while this fetch is open. Publishing
        // the pre-poke listing would roll both the cache and this caller's
        // answer back to the older draft, so the write is serialized against
        // snapshot mutations and stands down when one won the race.
        const applied = await this.#runSourceSnapshotMutation(async () => {
          const isSnapshotSuperseded = () =>
            this.contentContext !== warmupBaseContext ||
            this.#getCurrentSourceSnapshotIdentity() !== warmupIdentity ||
            this.sourceSnapshotVersion !== warmupSnapshotVersion;
          if (isSnapshotSuperseded()) {
            return false;
          }

          files = this.#overlayReservedDataPatches(files, warmupDataGeneration);
          listing = { ...fetchedListing, files };
          const sourceChanged = this.sourceSnapshotFiles === undefined
            ? this.hasAppliedSourceSnapshot
            : !sourceSnapshotsEqual(this.sourceSnapshotFiles, files);
          if (sourceChanged) {
            // Route discovery reads the persistent `stat:` and `dir:` tiers
            // before either in-memory structure is rebuilt, so clearing memory
            // alone would leave a stale listing -- or a negative
            // `stat:...:resolve` sentinel -- answering with the pre-edit file
            // set until those entries expired. Drop them before the new
            // snapshot is published rather than after, so no read can observe
            // the new generation while the old derived entries still stand.
            await IntrinsicReflectApply(PromiseAll, IntrinsicPromise, [[
              this.cache.deleteByPrefixAsync(buildFileCacheKeyPrefix(warmupContext)),
              this.cache.deleteByPrefixAsync(buildStatCacheKeyPrefix(warmupContext)),
              this.cache.deleteByPrefixAsync(buildDirCacheKeyPrefix(warmupContext)),
              this.cache.deleteByPrefixAsync(buildFileListCacheKey(warmupContext)),
            ]]);
            if (isSnapshotSuperseded()) {
              return false;
            }
            await this.#invalidateDerivedSourceCaches();
            if (isSnapshotSuperseded()) {
              return false;
            }
          }

          await this.#storeFileList(effectiveCacheKey, listing);
          // A poke can advance the generation while a distributed cache write
          // is pending. Remove the value that just landed before releasing the
          // mutation lock, so neither this waiter nor a later read sees it.
          if (isSnapshotSuperseded()) {
            await this.cache.deleteAsync(effectiveCacheKey);
            return false;
          }
          // A successful warmup is a newly observed source snapshot even when
          // no poke advanced the generation. Publish that generation before
          // retaining the list so in-memory indexes rebuild from these bytes.
          this.markSourceSnapshotChanged(files, warmupIdentity);
          if (sourceChanged) {
            this.statOps.clearIndex();
            this.dirOps.clearTree();
          }
          this.retainFileList(effectiveCacheKey, files);
          return true;
        });

        if (!applied) {
          logger.debug("Discarding file list warmup superseded by a newer source snapshot", {
            reason,
            cacheKey: effectiveCacheKey,
          });

          // Answer with the snapshot that superseded this fetch rather than
          // the listing it carries, so the caller stays as fresh as the poke.
          return await this.cache.getAsync<Array<{ path: string; content?: string }>>(
            effectiveCacheKey,
          ) ?? this.readRetainedFileList<{ path: string; content?: string }>(effectiveCacheKey) ??
            null;
        }

        const fileSummary = summarizeFileList(files);

        if (fileSummary.sourceFilesWithContent > 0 && this.shouldBackgroundPregenerateStyles()) {
          ignorePromiseRejection(this.triggerCSSPregeneration(files));
        }

        logger.debug("File list warmup complete", {
          reason,
          cacheKey: effectiveCacheKey,
          totalFiles: files.length,
          filesWithContent: files.filter((file) => file.content).length,
        });

        return files;
      } catch (error) {
        logger.warn("File list warmup failed", {
          reason,
          cacheKey: effectiveCacheKey,
          error: error instanceof Error ? error.message : String(error),
        });

        return null;
      } finally {
        if (warmupPromise && this.fileListWarmupPromise === warmupPromise) {
          this.fileListWarmupPromise = null;
          this.fileListWarmupKey = null;
        }
      }
    })();

    this.fileListWarmupPromise = warmupPromise;
    this.fileListWarmupKey = effectiveCacheKey;
    // That collaborator only needs completion, not the payload.
    this.readOps.setFileListReadyPromise(
      IntrinsicReflectApply(PromisePrototypeThen, warmupPromise, [() => undefined]) as Promise<
        void
      >,
    );
  }

  /**
   * Drop every in-memory view of the current source snapshot. Used by pokes
   * that invalidate without carrying replacement files inline, so the next read
   * re-derives everything from the API rather than from a superseded listing.
   */
  private clearMemoryCaches(): void {
    clearCachedReleaseAssetManifests();
    // An accepted poke may clear memory before its debounced replacement
    // listing arrives. Advance the generation immediately so an older warmup
    // cannot repopulate the cache or answer a waiting read in that window.
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.sourceSnapshotCheckedAt = 0;
    this.sourceSnapshotIdentity = undefined;
    this.sourceSnapshotFiles = undefined;
    this.sourceSnapshotFingerprint = undefined;
    this.agentConfigSourceSnapshotFingerprint = undefined;
    this.scopedAgentConfigSourceSnapshotFingerprint = undefined;
    // A source poke can change the configured discovery roots. Treat every
    // knowledge write as a possible definition until a run reports them again.
    this.#agentMarkdownDiscoveryPaths = undefined;
    this.clearRetainedFileList();
    this.readOps.clearFileListIndex();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
  }

  private markSourceSnapshotChanged(
    files: SourceSnapshotFile[],
    identity = this.#getCurrentSourceSnapshotIdentity(),
  ): void {
    this.sourceSnapshotFiles = files;
    this.hasAppliedSourceSnapshot = true;
    this.sourceSnapshotIdentity = identity;
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.sourceSnapshotCheckedAt = currentTime();
  }

  #runSourceSnapshotMutation<T>(operation: () => Promise<T>): Promise<T> {
    const recovered = IntrinsicReflectApply(
      PromisePrototypeCatch,
      this.sourceSnapshotMutationTail,
      [() => undefined],
    ) as Promise<void>;
    const mutation = IntrinsicReflectApply(PromisePrototypeThen, recovered, [operation]) as Promise<
      T
    >;
    this.sourceSnapshotMutationTail = IntrinsicReflectApply(
      PromisePrototypeThen,
      mutation,
      [() => undefined, () => undefined],
    ) as Promise<void>;
    return mutation;
  }

  private replaceSourceSnapshot(
    sourceCacheKey: string,
    listedFiles: SourceSnapshotFile[],
    expectedSnapshotVersion = this.sourceSnapshotVersion,
    expectedDataGeneration = this.#reservedDataGeneration,
  ): Promise<number | undefined> {
    // Pokes for a hosted adapter run in the credential context it connected
    // from, so publish the listing under the key that context reads.
    const cacheKey = scopeFileListCacheKeyToRequestAuthority(sourceCacheKey);
    const expectedContext = this.contentContext;
    const effectiveContext = this.getEffectiveContentContext();
    const sourceContentKey = effectiveContext && this.#getSourceContentKey(effectiveContext);
    return this.#runSourceSnapshotMutation(async () => {
      if (
        !expectedContext ||
        this.contentContext !== expectedContext ||
        this.sourceSnapshotVersion !== expectedSnapshotVersion ||
        this.getCurrentFileListCacheKey() !== cacheKey
      ) {
        logger.debug("Discarding superseded source snapshot", {
          cacheKey,
          projectSlug: this.projectSlug,
        });
        return undefined;
      }

      const files = this.#overlayReservedDataPatches(listedFiles, expectedDataGeneration);
      await this.cache.setAsync(cacheKey, files);
      if (
        this.contentContext !== expectedContext ||
        this.sourceSnapshotVersion !== expectedSnapshotVersion
      ) {
        // A newer poke invalidated this replacement while its distributed
        // cache write was pending. Remove the value that just landed and leave
        // memory empty so the next read derives the newer snapshot.
        await this.cache.deleteAsync(cacheKey);
        return undefined;
      }
      // The stat index and directory tree are built from the listing this
      // poke just replaced. Left standing they keep answering with the
      // pre-edit file set -- a file created by the edit reads as absent, and
      // one deleted by it reads as present.
      this.readOps.clearFileListIndex();
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      this.markSourceSnapshotChanged(files);
      // Retain after the version bump so the poked listing -- not the one it
      // replaced -- is what later reads see when the cache keeps nothing.
      this.retainFileList(cacheKey, files);
      // Poked listings carry contents, so fresh credentials can reuse them.
      if (sourceContentKey) {
        ignorePromiseRejection(admitVerifiedSourceContents(sourceContentKey, files));
      }
      return this.sourceSnapshotVersion;
    });
  }

  /**
   * Re-apply reserved data files patched after a listing started. The listing
   * may predate those writes; the patched entries are the newer answer.
   */
  #overlayReservedDataPatches(
    files: SourceSnapshotFile[],
    sinceGeneration: number,
  ): SourceSnapshotFile[] {
    const current = this.sourceSnapshotFiles;
    if (!current || this.#reservedDataGeneration === sinceGeneration) return files;
    const patches: ReservedDataPatch[] = [];
    for (const [projectPath, patch] of this.#reservedDataPatches) {
      if (patch.generation > sinceGeneration) {
        patches[patches.length] = { projectPath, entry: null };
      }
    }
    if (patches.length === 0) return files;
    for (let index = 0; index < current.length; index++) {
      const projectPath = toSnapshotProjectPath(current[index]!);
      const patch = projectPath === undefined
        ? undefined
        : findReservedDataPatch(patches, projectPath);
      if (patch && !patch.entry) patch.entry = current[index]!;
    }
    return patchSourceSnapshotEntries(files, patches);
  }

  #recordReservedDataPatches(patches: readonly ReservedDataPatch[]): void {
    this.#reservedDataGeneration++;
    const now = currentTime();
    for (let index = 0; index < patches.length; index++) {
      IntrinsicReflectApply(MapPrototypeSet, this.#reservedDataPatches, [
        patches[index]!.projectPath,
        { generation: this.#reservedDataGeneration, patchedAt: now },
      ]);
    }
    // A listing that started before a patch finishes within its request
    // deadline, so older records can no longer be needed by an overlay.
    for (const [projectPath, patch] of this.#reservedDataPatches) {
      if (now - patch.patchedAt > RESERVED_DATA_PATCH_RETENTION_MS) {
        IntrinsicReflectApply(MapPrototypeDelete, this.#reservedDataPatches, [projectPath]);
        IntrinsicReflectApply(MapPrototypeDelete, this.#reservedDataLatestRequests, [projectPath]);
      }
    }
  }

  /**
   * Whether a poke that changed only `changedPaths` can be applied by patching
   * those reserved data files into the current branch snapshot, leaving its
   * version and identity in place. Agents write knowledge files continuously
   * during runs; superseding the whole snapshot for each write would restart
   * every in-flight source refresh, so agent startup never settles.
   */
  canPatchReservedDataPaths(changedPaths: readonly string[]): boolean {
    if (changedPaths.length === 0 || changedPaths.length > MAX_RESERVED_DATA_POKE_PATHS) {
      return false;
    }
    if (!this.sourceSnapshotFiles || this.getEffectiveContentContext()?.sourceType !== "branch") {
      return false;
    }
    for (let index = 0; index < changedPaths.length; index++) {
      if (!isReservedDataPath(normalizeSourceSnapshotRetainPath(changedPaths[index]!))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Fetch the changed reserved data files and patch them into the snapshot:
   * content replaced, deleted files removed, new files added. The snapshot
   * version and identity stay, so refreshes in flight still apply. Returns
   * undefined when the files cannot be patched; the caller then invalidates
   * the whole snapshot.
   */
  async refreshReservedDataPaths(
    changedPaths: readonly string[],
  ): Promise<ReservedDataRefreshKind | undefined> {
    if (!this.canPatchReservedDataPaths(changedPaths)) return undefined;
    const context = this.contentContext;
    const effectiveContext = this.getEffectiveContentContext();
    if (!context || effectiveContext?.sourceType !== "branch") return undefined;
    const cacheKey = this.getCurrentFileListCacheKey();

    const projectPaths: string[] = [];
    for (let index = 0; index < changedPaths.length; index++) {
      const projectPath = normalizeSourceSnapshotRetainPath(changedPaths[index]!);
      let duplicate = false;
      for (let seen = 0; seen < projectPaths.length; seen++) {
        if (projectPaths[seen] === projectPath) duplicate = true;
      }
      if (!duplicate) projectPaths[projectPaths.length] = projectPath;
    }
    const requestSequence = ++this.#reservedDataRequestSequence;
    for (let index = 0; index < projectPaths.length; index++) {
      IntrinsicReflectApply(MapPrototypeSet, this.#reservedDataLatestRequests, [
        projectPaths[index]!,
        requestSequence,
      ]);
    }

    let fetched: ReservedDataPatch[];
    try {
      fetched = await IntrinsicReflectApply(PromiseAll, IntrinsicPromise, [
        projectPaths.map((projectPath) =>
          this.#fetchReservedDataPatch(projectPath, effectiveContext)
        ),
      ]) as ReservedDataPatch[];
    } catch (error) {
      logger.warn("Failed to refresh changed reserved data files", {
        projectSlug: this.projectSlug,
        changedPathsCount: projectPaths.length,
        error,
      });
      return undefined;
    }

    const applied = await this.#runSourceSnapshotMutation(async () => {
      if (this.contentContext !== context || this.getCurrentFileListCacheKey() !== cacheKey) {
        return false;
      }
      const current = this.sourceSnapshotFiles;
      if (!current) return true;
      const patches: ReservedDataPatch[] = [];
      for (let index = 0; index < fetched.length; index++) {
        const patch = fetched[index]!;
        const latest = IntrinsicReflectApply(MapPrototypeGet, this.#reservedDataLatestRequests, [
          patch.projectPath,
        ]);
        if (latest === requestSequence) patches[patches.length] = patch;
      }
      if (patches.length === 0) return true;

      const patched = patchSourceSnapshotEntries(current, patches);
      const snapshotVersion = this.sourceSnapshotVersion;
      this.sourceSnapshotFiles = patched;
      this.sourceSnapshotFingerprint = undefined;
      this.agentConfigSourceSnapshotFingerprint = undefined;
      this.scopedAgentConfigSourceSnapshotFingerprint = undefined;
      let retained = this.retainedFileList;
      if (retained && retained.cacheKey !== cacheKey) {
        // A listing retained for another source must not take these entries.
        this.clearRetainedFileList();
        retained = null;
      }
      if (retained) {
        retained.files = retained.files === current
          ? patched
          : patchSourceSnapshotEntries(retained.files, patches);
      }
      this.readOps.clearFileListIndex();
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      this.#recordReservedDataPatches(patches);

      if (retained) {
        await this.cache.setAsync(retained.cacheKey, retained.files);
        if (this.sourceSnapshotVersion !== snapshotVersion) {
          await this.cache.deleteAsync(retained.cacheKey);
        }
      } else if (cacheKey) {
        await this.cache.deleteAsync(cacheKey);
      }
      return true;
    });
    if (!applied) return undefined;

    logger.debug("Patched reserved data files into the source snapshot", {
      projectSlug: this.projectSlug,
      changedPathsCount: projectPaths.length,
      sourceSnapshotVersion: this.sourceSnapshotVersion,
    });
    return await this.#classifyReservedDataPaths(projectPaths);
  }

  async #fetchReservedDataPatch(
    projectPath: string,
    context: ResolvedContentContext,
  ): Promise<ReservedDataPatch> {
    try {
      const file = await this.client.getFile(projectPath, { expectedMissing: true }, {
        type: "branch",
        name: context.branch ?? "main",
      });
      const entry: SourceSnapshotFile = { path: file.path, content: file.content };
      if (file.id !== undefined) entry.id = file.id;
      if (file.version_id !== undefined) entry.version_id = file.version_id;
      if (file.type !== undefined) entry.type = file.type;
      if (file.size !== undefined) entry.size = file.size;
      return { projectPath, entry };
    } catch (error) {
      if (isNotFoundLikeError(error)) return { projectPath, entry: null };
      throw error;
    }
  }

  async #classifyReservedDataPaths(
    projectPaths: readonly string[],
  ): Promise<ReservedDataRefreshKind> {
    const markdownPaths = this.#agentMarkdownDiscoveryPaths;
    const files = this.sourceSnapshotFiles;
    if (!markdownPaths || !files) return "definition";
    const activeSkills = await collectActiveSkillDirectories(files, markdownPaths);
    if (!activeSkills) return "definition";
    for (let index = 0; index < projectPaths.length; index++) {
      if (
        !isExcludedAgentConfigDataPath(
          projectPaths[index]!,
          markdownPaths,
          activeSkills.skillDirectories,
        )
      ) {
        return "definition";
      }
    }
    return "data";
  }

  async #invalidateDerivedSourceCaches(): Promise<void> {
    const projectId = this.client.getProjectId();
    const invalidations: Array<void | Promise<void>> = [];

    if (projectId) {
      invalidations.push(
        this.invalidationCallbacks.clearSSRModuleCacheForProject?.(projectId),
        this.invalidationCallbacks.clearRouterDetectionCacheForProject?.(projectId),
        this.invalidationCallbacks.clearProjectDiscoveryCacheForProject?.(projectId),
        this.invalidationCallbacks.clearRendererCacheForProject?.(projectId),
      );
    } else {
      invalidations.push(this.invalidationCallbacks.clearSSRModuleCache?.());
    }

    invalidations.push(this.invalidationCallbacks.clearModulePathCache?.());
    if (this.projectSlug) {
      invalidations.push(
        this.invalidationCallbacks.clearSnippetCacheForProject?.(this.projectSlug),
        this.invalidationCallbacks.clearProjectCSSCache?.(this.projectSlug),
      );
    }

    const pendingInvalidations = invalidations.filter(
      (invalidation): invalidation is Promise<void> => invalidation !== undefined,
    );
    if (pendingInvalidations.length > 0) {
      await IntrinsicReflectApply(PromiseAll, IntrinsicPromise, [pendingInvalidations]);
    }
  }

  async #performSourceSnapshotRefresh(reason: string): Promise<void> {
    await this.#ensureInitialized();

    if (!this.contentContext) {
      logger.debug("Skipping source snapshot refresh without content context", {
        reason,
        projectSlug: this.projectSlug,
      });
      return;
    }

    const refreshContext = this.contentContext;
    const effectiveRefreshContext = this.getEffectiveContentContext() ?? refreshContext;
    const cacheKey = scopeFileListCacheKeyToRequestAuthority(
      buildFileListCacheKey(effectiveRefreshContext),
    );
    const refreshIdentity = this.#getCurrentSourceSnapshotIdentity();
    const previousVersion = this.sourceSnapshotVersion;
    const previousDataGeneration = this.#reservedDataGeneration;
    const fetchedListing = await this.#fetchSourceListing(effectiveRefreshContext);
    let files = fetchedListing.files;
    const result = await this.#runSourceSnapshotMutation(async () => {
      const isSnapshotSuperseded = () =>
        this.contentContext !== refreshContext ||
        this.#getCurrentSourceSnapshotIdentity() !== refreshIdentity ||
        this.sourceSnapshotVersion !== previousVersion;
      if (isSnapshotSuperseded()) {
        return { applied: false, sourceChanged: false };
      }

      // Reserved data writes patch the snapshot without superseding this
      // refresh. Compare against the patched snapshot, and keep any patch
      // newer than this listing.
      files = this.#overlayReservedDataPatches(files, previousDataGeneration);
      const listing = { ...fetchedListing, files };
      const sourceChanged = !sourceSnapshotsEqual(this.sourceSnapshotFiles, files);
      if (sourceChanged) {
        this.fileListWarmupPromise = null;
        this.fileListWarmupKey = null;
        this.clearRetainedFileList();
        this.readOps.clearFileListIndex();
        this.statOps.clearIndex();
        this.dirOps.clearTree();

        await IntrinsicReflectApply(PromiseAll, IntrinsicPromise, [[
          this.cache.deleteByPrefixAsync(buildFileCacheKeyPrefix(effectiveRefreshContext)),
          this.cache.deleteByPrefixAsync(buildStatCacheKeyPrefix(effectiveRefreshContext)),
          this.cache.deleteByPrefixAsync(buildDirCacheKeyPrefix(effectiveRefreshContext)),
          this.cache.deleteByPrefixAsync(buildFileListCacheKey(effectiveRefreshContext)),
        ]]);
        if (isSnapshotSuperseded()) {
          return { applied: false, sourceChanged: false };
        }
      }

      await this.#storeFileList(cacheKey, listing);
      if (isSnapshotSuperseded()) {
        await this.cache.deleteAsync(cacheKey);
        return { applied: false, sourceChanged: false };
      }

      if (sourceChanged) {
        await this.#invalidateDerivedSourceCaches();
        if (isSnapshotSuperseded()) {
          await this.cache.deleteAsync(cacheKey);
          return { applied: false, sourceChanged: false };
        }
        // Publish freshness only after every cache derived from the previous
        // snapshot has been invalidated. Concurrent followers remain attached
        // to the refresh singleflight until this point.
        this.markSourceSnapshotChanged(files, refreshIdentity);
      } else {
        // Equal listings keep the published array identity. A fingerprint may
        // still be hashing this exact snapshot, and replacing an equal array
        // would make that valid digest resolve unavailable without advancing
        // the version that keys its cache.
        this.sourceSnapshotIdentity = refreshIdentity;
        this.sourceSnapshotCheckedAt = currentTime();
        // The API just confirmed this listing is current, so the index built
        // from it may answer "absent" on its own again. Skipping this leaves
        // the index expired after the first probe past
        // INDEX_AUTHORITY_LIMIT_MS, and every later probe repeats this refresh
        // to be told the same thing -- the per-probe fan-out, five minutes in.
        this.statOps.renewIndexAuthority();
      }

      const recoveryKeyPrefix = this.#getBranchMissRecoveryKeyPrefix();
      for (const key of this.branchMissRecoveryFailures.keys()) {
        if (key.startsWith(recoveryKeyPrefix)) this.branchMissRecoveryFailures.delete(key);
      }
      this.retainFileList(cacheKey, files);

      return { applied: true, sourceChanged };
    });

    if (!result.applied) {
      logger.debug("Discarding stale source snapshot refresh", {
        reason,
        cacheKey,
        projectSlug: this.projectSlug,
      });
      return;
    }

    const fileSummary = summarizeFileList(files);

    if (
      result.sourceChanged &&
      fileSummary.sourceFilesWithContent > 0 &&
      this.shouldBackgroundPregenerateStyles()
    ) {
      ignorePromiseRejection(this.triggerCSSPregeneration(files));
    }

    logger.info("Refreshed source snapshot", {
      reason,
      cacheKey,
      projectSlug: this.projectSlug,
      sourceType: refreshContext.sourceType,
      branch: refreshContext.branch,
      environmentName: refreshContext.environmentName,
      releaseId: refreshContext.releaseId,
      totalFiles: fileSummary.totalFiles,
      filesWithContent: fileSummary.filesWithContent,
      sourceChanged: result.sourceChanged,
      sourceSnapshotVersion: this.sourceSnapshotVersion,
    });
  }

  async #refreshSourceSnapshot(reason: string): Promise<void> {
    await this.#ensureInitialized();

    while (true) {
      this.sourceSnapshotRefreshPromise ??= this.#performSourceSnapshotRefresh(reason);
      const refresh = this.sourceSnapshotRefreshPromise;

      try {
        await refresh;
      } finally {
        if (this.sourceSnapshotRefreshPromise === refresh) {
          this.sourceSnapshotRefreshPromise = null;
        }
      }

      const currentIdentity = this.#getCurrentSourceSnapshotIdentity();
      if (
        currentIdentity === undefined ||
        this.sourceSnapshotIdentity === currentIdentity
      ) return;
    }
  }

  async refreshSourceSnapshot(reason = "manual-refresh"): Promise<void> {
    await this.#refreshSourceSnapshot(reason);
  }

  async ensureSourceSnapshotFresh(
    reason = "freshness-check",
    options?: SourceSnapshotFreshnessOptions,
    initializedByManager = false,
  ): Promise<void> {
    const initializedNow = initializedByManager || await this.#ensureInitialized();
    if (this.contentContext?.sourceType !== "branch") return;

    // The snapshot identity only names the branch, so an edit to a draft file
    // never changes it. The lease age is therefore the only thing that can
    // detect a content change, and a caller that cannot tolerate a stale render
    // asks for maxAgeMs: 0 to bypass it.
    const maxAgeMs = options?.maxAgeMs ?? BRANCH_SOURCE_SNAPSHOT_FRESHNESS_MS;

    // Cold initialization just fetched and installed the complete listing for
    // this branch. That authority check happened inside this call, so it also
    // satisfies a zero-age caller without immediately listing the same source
    // tree a second time.
    if (
      initializedNow &&
      this.sourceSnapshotIdentity === this.#getCurrentSourceSnapshotIdentity() &&
      this.sourceSnapshotCheckedAt > 0
    ) {
      return;
    }

    // A non-positive budget bypasses the lease unconditionally. Comparing the
    // age against it would not: a backward wall-clock step makes the age
    // negative, and a negative age is below every budget, so the caller that
    // asked to accept no lease at all would silently be handed one.
    if (
      maxAgeMs > 0 &&
      this.sourceSnapshotIdentity === this.#getCurrentSourceSnapshotIdentity() &&
      currentTime() - this.sourceSnapshotCheckedAt < maxAgeMs
    ) {
      return;
    }

    await this.#refreshSourceSnapshot(reason);
  }

  getSourceSnapshotVersion(): number {
    return this.sourceSnapshotVersion;
  }

  getSourceSnapshotFingerprint(
    options?: SourceSnapshotFingerprintOptions,
  ): Promise<string | undefined> {
    const purpose = options?.purpose === "agent-config" ? "agent-config" : "complete";
    const markdownPaths = captureSourceSnapshotMarkdownDiscoveryPaths(options);
    const hasMarkdownPaths = markdownPaths.agent.length > 0 || markdownPaths.skill.length > 0;
    const markdownScopeKey = hasMarkdownPaths
      ? buildSourceSnapshotMarkdownScopeKey(markdownPaths)
      : undefined;
    if (hasMarkdownPaths) this.#agentMarkdownDiscoveryPaths = markdownPaths;
    const files = this.sourceSnapshotFiles;
    if (!files) {
      return IntrinsicReflectApply(PromiseResolve, IntrinsicPromise, [undefined]) as Promise<
        undefined
      >;
    }

    const version = this.sourceSnapshotVersion;
    const cached = purpose === "agent-config"
      ? hasMarkdownPaths
        ? this.scopedAgentConfigSourceSnapshotFingerprint?.scopeKey === markdownScopeKey
          ? this.scopedAgentConfigSourceSnapshotFingerprint
          : undefined
        : this.agentConfigSourceSnapshotFingerprint
      : this.sourceSnapshotFingerprint;
    if (cached?.version === version) {
      return cached.value;
    }

    const value = (async () => {
      const fingerprint = await computeSourceSnapshotFingerprint(files, purpose, markdownPaths);
      return this.sourceSnapshotVersion === version && this.sourceSnapshotFiles === files
        ? fingerprint
        : undefined;
    })();
    if (purpose === "agent-config" && !hasMarkdownPaths) {
      this.agentConfigSourceSnapshotFingerprint = { version, value };
    } else if (purpose === "agent-config" && markdownScopeKey !== undefined) {
      this.scopedAgentConfigSourceSnapshotFingerprint = {
        version,
        scopeKey: markdownScopeKey,
        value,
      };
    } else if (purpose === "complete") {
      this.sourceSnapshotFingerprint = { version, value };
    }
    return value;
  }

  /**
   * Names the branch/environment/release the snapshot currently targets, so a
   * caller that established freshness earlier in a request can detect a
   * context change (for example `setRequestBranch` on this reused adapter)
   * before trusting that establishment.
   */
  getSourceSnapshotIdentity(): string | undefined {
    return this.#getCurrentSourceSnapshotIdentity();
  }

  async readDependencyMetadataHistory(signal?: AbortSignal): Promise<DependencyMetadataHistory> {
    throwIfAborted(signal);
    await awaitAbortable(this.#ensureExactReadInitialized(), signal);
    const source = this.getEffectiveContentContext();
    if (source?.sourceType !== "branch") {
      throw new TypeError("Dependency metadata history is available only for branch sources");
    }
    const branch = source.branch && source.branch !== "main" ? source.branch : null;
    return await this.client.readDependencyMetadataHistory(branch, signal);
  }

  getPokeMetrics(): {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  } {
    return this.wsManager.getPokeMetrics();
  }

  async readFile(path: string): Promise<string> {
    await this.#ensureInitialized();
    return this.#withBranchSnapshotRecovery(path, () => this.readOps.readTextFile(path));
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    await this.#ensureInitialized();
    return this.#withBranchSnapshotRecovery(path, () => this.readOps.readFile(path));
  }

  async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    const admittedLimit = requireBoundedFileReadLimit(byteLimit);
    await this.#ensureExactReadInitialized();
    return this.#withBranchSnapshotRecovery(
      path,
      () => this.readOps.readFileBytesWithinLimit(path, admittedLimit),
    );
  }

  async readTextFile(path: string): Promise<string> {
    await this.#ensureInitialized();
    return this.#withBranchSnapshotRecovery(path, () => this.readOps.readTextFile(path));
  }

  async readOptionalTextFile(path: string): Promise<string> {
    await this.#ensureInitialized();
    return this.#withBranchSnapshotRecovery(path, () => this.readOps.readOptionalTextFile(path));
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    await this.#ensureInitialized();
    return this.#withBranchSnapshotRecovery(
      path,
      () => this.dirOps.readdir(path),
      {
        isRecoverableMissResult: (entries) => entries.length === 0,
        requirePendingSourceInvalidation: true,
      },
    );
  }

  async stat(path: string): Promise<FileInfo> {
    await this.#ensureInitialized();
    return this.#withBranchSnapshotRecovery(path, () => this.statOps.stat(path));
  }

  async exists(path: string): Promise<boolean> {
    await this.#ensureInitialized();
    try {
      await this.#withBranchSnapshotRecovery(path, () => this.statOps.stat(path));
      return true;
    } catch (_) {
      return false;
    }
  }

  async resolveFile(
    basePath: string,
    options?: ResolveFileOptions,
  ): Promise<string | null> {
    await this.#ensureInitialized();
    return this.#withBranchSnapshotRecovery(
      basePath,
      () => this.statOps.resolveFile(basePath, options),
      {
        isRecoverableMissResult: (resolvedPath) => resolvedPath === null,
        requirePendingSourceInvalidation: true,
      },
    );
  }

  dispose(): void {
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.sourceSnapshotCheckedAt = 0;
    this.sourceSnapshotIdentity = undefined;
    this.sourceSnapshotFiles = undefined;
    this.sourceSnapshotFingerprint = undefined;
    this.agentConfigSourceSnapshotFingerprint = undefined;
    this.scopedAgentConfigSourceSnapshotFingerprint = undefined;
    this.sourceSnapshotRefreshPromise = null;
    this.wsManager.dispose();
    this.manifestFetcherCleanup?.();
    this.manifestFetcherCleanup = null;
    this.cache.clear();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.initialized = false;
    this.initializationGeneration++;
    this.initializationPromise = null;
    this.exactReadInitializationPromise = null;
    this.exactReadInitializationGeneration++;
    this.fileListWarmupPromise = null;
    this.fileListWarmupKey = null;
    this.clearRetainedFileList();
    this.branchMissRecoveryPromises.clear();
    this.branchMissRecoveryFailures.clear();

    logger.debug("Disposed");
  }

  getCacheStats(): CacheStats {
    return { cache: this.cache.stats(), poke: this.getPokeMetrics() };
  }

  getProjectData(): Project | undefined {
    return this.projectData;
  }

  /**
   * @param options.waitForWarmup wait for an in-flight file-list fetch instead
   * of answering empty. Off by default: most callers can proceed without the
   * list and must not pay for the fetch, but a caller that has no other way to
   * obtain it -- CSP derivation on a release-backed context, where nothing else
   * populates the cache -- would otherwise read empty on every request forever.
   */
  async getAllSourceFiles(
    options: { waitForWarmup?: boolean } = {},
  ): Promise<Array<{ path: string; content?: string }>> {
    if (!this.contentContext) {
      logger.debug("getAllSourceFiles called without contentContext", {
        initialized: this.initialized,
        projectSlug: this.projectSlug,
      });
      return [];
    }

    const contentContext = this.getEffectiveContentContext();
    if (!contentContext) return [];
    const cacheKey = scopeFileListCacheKeyToRequestAuthority(buildFileListCacheKey(contentContext));
    const cached = await this.getCachedFileListAsync<{ path: string; content?: string }>(
      "getAllSourceFiles: no contentContext",
      "getAllSourceFiles",
      "getAllSourceFiles miss",
      {
        cacheKey,
        contentContext,
        waitForWarmup: options.waitForWarmup,
      },
    );
    const files = cached?.files;

    if (!cacheKey || !files?.length) {
      logger.debug("getAllSourceFiles cache miss or empty", {
        cacheKey,
        initialized: this.initialized,
        hasFiles: !!files,
        fileCount: files?.length ?? 0,
      });
      return [];
    }

    const fileSummary = summarizeFileList(files);

    logger.debug("getAllSourceFiles returning", {
      cacheKey,
      totalFiles: fileSummary.totalFiles,
      filesWithContent: fileSummary.filesWithContent,
      sourceFiles: fileSummary.sourceFiles,
      sourceFilesWithContent: fileSummary.sourceFilesWithContent,
    });

    return files;
  }

  getEntityIdForPath(path: string): string | undefined {
    const normalizedPath = this.normalizer.normalize(path);
    const cachedFiles = this.getCachedFileListSync<{ id?: string; path: string }>();

    return cachedFiles?.find((f) => f.path === normalizedPath)?.id;
  }

  getFilePathByEntityId(entityId: string): string | undefined {
    const cachedFiles = this.getCachedFileListSync<{ id?: string; path: string }>();

    return cachedFiles?.find((f) => f.id === entityId)?.path;
  }

  async getFilePathByEntityIdAsync(
    entityId: string,
  ): Promise<{ path: string; body?: string } | undefined> {
    const cachedPath = this.getFilePathByEntityId(entityId);
    if (cachedPath) return { path: cachedPath };

    logger.debug("Fetching file by entity ID from API", { entityId });

    try {
      const file = await this.client.getFileById(entityId);
      if (!file) return undefined;

      logger.debug("File resolved from API", {
        entityId,
        path: file.path,
        contentLength: file.content.length,
      });

      return { path: file.path, body: file.content };
    } catch (error) {
      logger.warn("Failed to fetch file by entity ID", {
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  setRequestToken(token: string): void {
    if (token !== this.activeRequestToken) {
      this.activeRequestToken = token;
      this.invalidateRequestAuthoritySnapshot();
    }
    this.client.setRequestToken(token);
    this.wsManager.setApiToken(token);
  }

  clearRequestToken(): void {
    if (this.activeRequestToken !== this.apiToken) {
      this.activeRequestToken = this.apiToken;
      this.invalidateRequestAuthoritySnapshot();
    }
    this.client.clearRequestToken();
    this.wsManager.setApiToken(this.apiToken);
  }

  private invalidateRequestAuthoritySnapshot(clearFileCache = true): void {
    if (clearFileCache) this.cache.clear();
    this.clearRetainedFileList();
    this.readOps.clearFileListIndex();
    this.statOps.clearIndex();
    this.dirOps.clearTree();
    this.fileListWarmupPromise = null;
    this.fileListWarmupKey = null;
    this.branchMissRecoveryPromises.clear();
    this.branchMissRecoveryFailures.clear();
    this.sourceSnapshotCheckedAt = 0;
    this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
    this.sourceSnapshotRefreshPromise = null;
    this.sourceSnapshotIdentity = undefined;
    this.sourceSnapshotFiles = undefined;
  }

  setRequestBranch(branch: string | null): void {
    if (branch !== this.requestBranch) {
      this.requestBranch = branch;
      // File cache keys already include the effective request branch. Retain
      // those scoped entries, especially the process-wide immutable release
      // L1 owned by FileCache, while resetting branch-sensitive indexes.
      this.invalidateRequestAuthoritySnapshot(false);
    } else {
      this.requestBranch = branch;
    }
    this.syncClientContext();
  }

  getRequestBranch(): string | null {
    return this.requestBranch;
  }

  clearRequestBranch(): void {
    if (this.requestBranch !== null) {
      this.requestBranch = null;
      this.invalidateRequestAuthoritySnapshot(false);
    } else {
      this.requestBranch = null;
    }
    this.syncClientContext();
  }

  setContentContext(context: ResolvedContentContext): void {
    const oldContext = this.contentContext;
    const contextChanged = hasContentContextChanged(oldContext, context);

    logger.debug("setContentContext called", {
      newSourceType: context.sourceType,
      newProjectSlug: context.projectSlug,
      newBranch: context.branch,
      newReleaseId: context.releaseId,
      newEnvironmentName: context.environmentName,
      oldSourceType: oldContext?.sourceType,
      oldBranch: oldContext?.branch,
      oldReleaseId: oldContext?.releaseId,
      contextWillChange: contextChanged,
    });

    const nextReleaseId = context.releaseId;

    this.manifestFetcherCleanup?.();
    this.manifestFetcherCleanup = null;

    // Register a per-releaseId manifest fetcher so production HTML can
    // consult ready manifests when the feature flag is on. Using the per-
    // releaseId registry ensures the correct project-scoped token is always
    // used, even under multi-tenant / proxy-manager operation.
    if (nextReleaseId) {
      this.manifestFetcherCleanup = registerManifestFetcherForRelease(
        nextReleaseId,
        buildManifestFetcher(this.client),
      );
    }

    this.contentContext = context;
    this.syncClientContext();

    if (contextChanged) {
      this.statOps.clearIndex();
      this.dirOps.clearTree();
      // The read path's file-list index keys its cached content map on
      // `length:firstPath:lastPath` and, when the backing cache entry has
      // expired, keeps serving that map for up to its staleness limit. Neither
      // guard knows which branch, environment, or release the listing came
      // from, so without an explicit clear here two contexts whose listings
      // happen to agree on those three values would serve each other's file
      // contents -- and cache them under the new context's key.
      this.readOps.clearFileListIndex();
      this.fileListWarmupPromise = null;
      this.fileListWarmupKey = null;
      this.clearRetainedFileList();
      this.branchMissRecoveryPromises.clear();
      this.branchMissRecoveryFailures.clear();
      this.sourceSnapshotCheckedAt = 0;
      this.sourceSnapshotVersion = nextSourceSnapshotGeneration();
      this.sourceSnapshotIdentity = undefined;
      this.sourceSnapshotFiles = undefined;
      this.sourceSnapshotRefreshPromise = null;
      logger.debug("Cleared index and dirTree due to context change", {
        oldContext,
        newContext: context,
      });
    }

    logger.debug("Content context set complete", {
      sourceType: context.sourceType,
      projectSlug: context.projectSlug,
    });
  }

  getContentContext(): ResolvedContentContext | null {
    if (!this.contentContext) {
      logger.warn("getContentContext returning null", {
        projectSlug: this.projectSlug,
        initialized: this.initialized,
        hasClient: !!this.client,
      });
    }
    return this.contentContext;
  }

  getClient(): VeryfrontApiClient {
    return this.client;
  }

  async #ensureInitialized(): Promise<boolean> {
    if (this.initialized) return false;
    await this.initialize();
    return true;
  }

  async #ensureExactReadInitialized(): Promise<void> {
    if (this.client.isInitialized() && this.contentContext) return;
    if (this.exactReadInitializationPromise) {
      await this.exactReadInitializationPromise;
      return;
    }

    const generation = ++this.exactReadInitializationGeneration;
    const initialization = (async () => {
      await this.client.initialize();
      if (!this.contentContext) {
        this.setContentContext(
          await resolveContentContext(this.client, this.contentSource, this.projectSlug),
        );
      }
      if (!this.contentContext) {
        throw toError(
          createError({
            type: "config",
            message: "Veryfront adapter content context resolution failed",
          }),
        );
      }
    })();
    this.exactReadInitializationPromise = initialization;
    try {
      await initialization;
    } finally {
      if (this.exactReadInitializationGeneration === generation) {
        this.exactReadInitializationPromise = null;
      }
    }
  }

  /**
   * Trigger CSS pre-generation for faster first-request latency.
   *
   * Runs CSS extraction and generation in parallel with other initialization.
   * Uses dynamic import to avoid circular dependencies.
   */
  private async triggerCSSPregeneration(
    files: StylePregenerationFile[],
  ): Promise<{ hash: string; assetPath: string } | undefined> {
    const pregenerateStyles = this.styleCallbacks.pregenerateStyles;
    if (!pregenerateStyles) {
      logger.debug("Skipping CSS pre-generation without style callback", {
        projectSlug: this.projectSlug,
      });
      return undefined;
    }

    try {
      const projectDir = this.normalizer.getProjectDir();
      const result = await pregenerateStyles(files, {
        projectSlug: this.projectSlug,
        projectDir,
        contentContext: this.contentContext,
      });

      if (!result) return undefined;

      logger.debug("CSS pre-generation complete", {
        projectSlug: this.projectSlug,
        cssHash: result.hash,
      });

      return {
        hash: result.hash,
        assetPath: `/_vf/css/${result.hash}.css`,
      };
    } catch (error) {
      logger.warn("CSS pre-generation failed", {
        projectSlug: this.projectSlug,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
