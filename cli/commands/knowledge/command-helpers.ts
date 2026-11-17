import type { ApiClient } from "#cli/shared/config";
import { INVALID_ARGUMENT } from "veryfront/errors";
import { createFileSystem } from "veryfront/platform";
import { basename, extname, isAbsolute, join, normalize, relative } from "veryfront/platform/path";
import { inspectOkfDocument } from "veryfront/knowledge";
import { computeHash } from "veryfront/utils";
import type { RemoteFileWriteExpectation } from "../files/command.ts";
import { classifyKnowledgeDirectoryPath, classifyKnowledgeSourcePath } from "./source-policy.ts";
import type {
  KnowledgeIngestFailedFileResult,
  KnowledgeIngestFileResult,
  KnowledgeIngestSkippedFileResult,
} from "./result.ts";

export type KnowledgeSource =
  | { kind: "local"; input: string; localPath: string }
  | { kind: "upload"; input: string; uploadPath: string; localPath: string };

export interface KnowledgeSourceCollection {
  sources: KnowledgeSource[];
  skipped: KnowledgeIngestSkippedFileResult[];
}

const CHAT_UPLOAD_PREFIX_RE =
  /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+-[a-z0-9]+-/i;

export function normalizeKnowledgeInputPath(inputPath: string): string {
  const rawPath = inputPath.replaceAll("\\", "/");
  const normalizedPath = normalize(inputPath).replace(/^\/+/, "").replaceAll("\\", "/");
  if (
    rawPath.split("/").includes("..") || !normalizedPath || normalizedPath.startsWith("..") ||
    normalizedPath.startsWith("/") || normalizedPath.split("/").includes("..")
  ) {
    throw INVALID_ARGUMENT.create({ detail: `Invalid knowledge input path: ${inputPath}` });
  }
  return normalizedPath;
}

export function normalizeKnowledgeRelativePath(
  inputPath: string,
  label = "knowledge relative path",
): string {
  const rawPath = inputPath.replaceAll("\\", "/");
  const normalizedPath = normalize(inputPath).replace(/^\/+/, "").replaceAll("\\", "/");
  if (
    rawPath.split("/").includes("..") || !normalizedPath || normalizedPath.startsWith("..") ||
    normalizedPath.startsWith("/") || normalizedPath.split("/").includes("..")
  ) {
    throw INVALID_ARGUMENT.create({ detail: `Invalid ${label}: ${inputPath}` });
  }
  return normalizedPath;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/(?<!\/)\/+$/, "");
}

function relativeToNormalizedPrefix(path: string, prefix: string): string {
  const normalizedPath = normalizeKnowledgeInputPath(path);
  const normalizedPrefix = stripTrailingSlash(normalizeKnowledgeInputPath(prefix));
  if (normalizedPath === normalizedPrefix) {
    throw INVALID_ARGUMENT.create({
      detail: `OKF bundle source is the bundle root, not a file: ${path}`,
    });
  }
  if (!normalizedPath.startsWith(`${normalizedPrefix}/`)) {
    throw INVALID_ARGUMENT.create({
      detail: `OKF bundle source is outside declared bundle root: ${path}`,
    });
  }
  return normalizeKnowledgeRelativePath(
    normalizedPath.slice(normalizedPrefix.length + 1),
    "OKF bundle relative path",
  );
}

export function deriveOkfBundleRelativePath(source: KnowledgeSource, bundleRoot: string): string {
  if (source.kind === "upload") {
    return relativeToNormalizedPrefix(source.uploadPath, bundleRoot);
  }

  const root = normalize(bundleRoot).replaceAll("\\", "/");
  const localPath = normalize(source.localPath).replaceAll("\\", "/");
  const relativePath = relative(root, localPath).replaceAll("\\", "/");
  return normalizeKnowledgeRelativePath(relativePath, "OKF bundle relative path");
}

export function normalizeProjectUploadPath(inputPath: string): string {
  return normalizeKnowledgeInputPath(inputPath);
}

export function formatKnowledgeUploadSource(uploadPath: string): string {
  const normalizedPath = normalizeKnowledgeInputPath(uploadPath);
  return normalizedPath === "uploads" || normalizedPath.startsWith("uploads/")
    ? normalizedPath
    : `uploads/${normalizedPath}`;
}

export function resolveExplicitUploadPath(inputPath: string): string {
  const normalizedInput = normalizeKnowledgeInputPath(inputPath);
  const displayInput = inputPath.replaceAll("\\", "/");
  const uploadPath = normalizeProjectUploadPath(inputPath);
  if (
    !uploadPath || uploadPath === "uploads" || normalizedInput === "uploads" ||
    normalizedInput.endsWith("/")
  ) {
    throw new Error(
      `Directory upload references require --path <prefix> --all: ${displayInput}`,
    );
  }
  return uploadPath;
}

export function isLikelyLocalPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(value);
}

export function isProjectUploadReference(value: string): boolean {
  if (isLikelyLocalPath(value)) return false;
  const normalizedValue = normalize(value).replaceAll("\\", "/").replace(/^\/+/, "");
  return normalizedValue === "uploads" || normalizedValue.startsWith("uploads/");
}

export function stripChatUploadPrefix(name: string): string {
  return name.replace(CHAT_UPLOAD_PREFIX_RE, "");
}

export function resolveKnowledgeDownloadOutputDir(outputDir: string): string {
  return join(outputDir, ".uploads");
}

export function createSkippedKnowledgeSource(input: {
  source: string;
  localSourcePath?: string | null;
  message: string;
  reason: KnowledgeIngestSkippedFileResult["reason"];
}): KnowledgeIngestSkippedFileResult {
  return {
    source: input.source,
    localSourcePath: input.localSourcePath ?? null,
    message: input.message,
    reason: input.reason,
  };
}

export function createFailedKnowledgeSource(input: {
  source: string;
  localSourcePath: string;
  message: string;
  reason: KnowledgeIngestFailedFileResult["reason"];
}): KnowledgeIngestFailedFileResult {
  return {
    source: input.source,
    localSourcePath: input.localSourcePath,
    message: input.message,
    reason: input.reason,
  };
}

function classifySourceOrSkip(input: {
  source: string;
  localSourcePath?: string | null;
}): KnowledgeIngestSkippedFileResult | null {
  const decision = classifyKnowledgeSourcePath(input.source);
  if (decision.kind === "ingest") {
    return null;
  }

  return createSkippedKnowledgeSource({
    source: input.source,
    localSourcePath: input.localSourcePath,
    message: decision.message,
    reason: decision.reason,
  });
}

function classifyDirectoryOrSkip(
  input: { source: string; allowHidden?: boolean },
): KnowledgeIngestSkippedFileResult | null {
  const decision = classifyKnowledgeDirectoryPath(input.source, input.allowHidden);
  if (decision.kind === "ingest") {
    return null;
  }

  return createSkippedKnowledgeSource({
    source: input.source,
    localSourcePath: null,
    message: decision.message,
    reason: decision.reason,
  });
}

export async function collectLocalFiles(
  root: string,
  recursive: boolean,
  okfBundle = false,
): Promise<KnowledgeSourceCollection> {
  const fs = createFileSystem();
  const stat = await fs.stat(root);
  if (stat.isFile) {
    const skipped = okfBundle
      ? null
      : classifySourceOrSkip({ source: root, localSourcePath: root });
    return skipped == null
      ? {
        sources: [{ kind: "local", input: root, localPath: root }],
        skipped: [],
      }
      : {
        sources: [],
        skipped: [skipped],
      };
  }
  if (!stat.isDirectory) {
    return { sources: [], skipped: [] };
  }

  const skippedRootDirectory = classifyDirectoryOrSkip({ source: root, allowHidden: okfBundle });
  if (skippedRootDirectory != null) {
    return {
      sources: [],
      skipped: [skippedRootDirectory],
    };
  }

  const collection: KnowledgeSourceCollection = {
    sources: [],
    skipped: [],
  };
  async function walk(dir: string): Promise<void> {
    for await (const entry of fs.readDir(dir)) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory) {
        const skipped = classifyDirectoryOrSkip({ source: entryPath, allowHidden: okfBundle });
        if (skipped != null) {
          collection.skipped.push(skipped);
          continue;
        }
        if (recursive) await walk(entryPath);
        continue;
      }

      if (!entry.isFile) {
        continue;
      }

      const skipped = okfBundle
        ? null
        : classifySourceOrSkip({ source: entryPath, localSourcePath: entryPath });
      if (skipped != null) {
        collection.skipped.push(skipped);
        continue;
      }

      collection.sources.push({ kind: "local", input: root, localPath: entryPath });
    }
  }

  await walk(root);
  collection.sources.sort((left, right) => left.localPath.localeCompare(right.localPath));
  collection.skipped.sort((left, right) => left.source.localeCompare(right.source));
  return collection;
}

export function buildSourceReference(source: KnowledgeSource): string {
  return source.kind === "upload"
    ? formatKnowledgeUploadSource(source.uploadPath)
    : source.localPath;
}

/** Studio stages Add Knowledge uploads under `_knowledge-ingest/<batch>/`; the rest is the user's path. */
const KNOWLEDGE_INGEST_STAGING_RE = /^uploads\/_knowledge-ingest\/[^/]+\/(.+)$/;

/** The OKF `resource`: the path the user uploaded, or the local path. */
export function buildKnowledgeResource(source: KnowledgeSource): string {
  // Local path spelling distinguishes an explicit disk path from an upload reference.
  if (source.kind === "local") return source.localPath;
  const reference = buildSourceReference(source);
  return KNOWLEDGE_INGEST_STAGING_RE.exec(reference)?.[1] ?? reference;
}

/** Stable origin-specific identity for generated documents. Studio's batch ID is transient. */
export function buildKnowledgeIngestIdentity(
  source: KnowledgeSource,
): { resource: string; sourceKey: string } {
  if (source.kind === "local") {
    const resource = normalize(source.localPath);
    return { resource, sourceKey: JSON.stringify(["local", resource]) };
  }
  const reference = buildSourceReference(source);
  const stagedReference = KNOWLEDGE_INGEST_STAGING_RE.exec(reference)?.[1];
  const resource = stagedReference ?? reference;
  const kind = stagedReference === undefined ? "upload" : "staged-upload";
  return { resource, sourceKey: JSON.stringify([kind, resource]) };
}

export function readKnowledgeIngestSourceKey(
  metadata: Record<string, unknown>,
): string | undefined {
  const generated = metadata.generated;
  return generated && typeof generated === "object" && "source_key" in generated &&
      typeof generated.source_key === "string"
    ? generated.source_key
    : undefined;
}

/** The file name the user gave the source, without a chat upload prefix. */
export function buildKnowledgeSourceFileName(source: KnowledgeSource): string {
  const name = basename(source.kind === "upload" ? source.uploadPath : source.localPath);
  return stripChatUploadPrefix(name) || name;
}

const CUSTOM_SOURCE_HASH_LENGTH = 16;
// Leave room in a 255-byte filesystem component for the longest collision suffix.
const MAX_CUSTOM_SLUG_LENGTH = 255 - "-source-".length - CUSTOM_SOURCE_HASH_LENGTH - ".md".length;

function buildCustomKnowledgeName(source: KnowledgeSource, legacy: boolean): string {
  const stagedReference = source.kind === "upload"
    ? KNOWLEDGE_INGEST_STAGING_RE.exec(buildSourceReference(source))?.[1]
    : undefined;
  const sourcePath = source.kind === "upload" ? source.uploadPath : source.localPath;
  const normalized = normalize((legacy ? undefined : stagedReference) ?? sourcePath).replaceAll(
    "\\",
    "/",
  );

  let stem: string;
  if (!legacy && stagedReference !== undefined) {
    stem = normalized.replace(/\.[^.]+$/, "");
  } else if (source.kind === "upload") {
    stem = normalized
      .replace(/^\/workspace\/uploads\//, "")
      .replace(/^\/workspace\//, "")
      .replace(/^uploads\//, "")
      .replace(/\.[^.]+$/, "");
  } else if (normalized.startsWith("/workspace/uploads/")) {
    stem = normalized.replace(/^\/workspace\/uploads\//, "").replace(/\.[^.]+$/, "");
  } else if (normalized.startsWith("/workspace/")) {
    stem = normalized.replace(/^\/workspace\//, "").replace(/\.[^.]+$/, "");
  } else if (legacy ? normalized.startsWith("/") : isAbsolute(normalized)) {
    stem = basename(normalized, extname(normalized));
  } else {
    stem = normalized.replace(/\.[^.]+$/, "");
  }

  const lastSlash = stem.lastIndexOf("/");
  const directory = stem.slice(0, lastSlash + 1);
  const filename = stripChatUploadPrefix(stem.slice(lastSlash + 1));
  return `${directory}${filename}` || basename(normalized, extname(normalized));
}

function slugifyCustomKnowledgeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|(?<!-)-+$/g, "") ||
    "document";
}

/** Keep generated files at source-derived paths while bounding new filenames. */
export async function buildCustomKnowledgeSlug(source: KnowledgeSource): Promise<string> {
  const name = buildCustomKnowledgeName(source, false);
  const slug = slugifyCustomKnowledgeName(name);
  if (slug.length <= MAX_CUSTOM_SLUG_LENGTH) return escapeReservedKnowledgeSlug(slug);
  const prefix = slug.slice(0, MAX_CUSTOM_SLUG_LENGTH - CUSTOM_SOURCE_HASH_LENGTH - 1)
    .replace(/-+$/, "");
  return `${prefix}-${(await computeHash(name)).slice(0, CUSTOM_SOURCE_HASH_LENGTH)}`;
}

/** One automatic custom destination per typed source, independent of occupancy. */
export async function buildCustomKnowledgePath(
  source: KnowledgeSource,
  rootPath: string,
): Promise<string> {
  const slug = await buildCustomKnowledgeSlug(source);
  const prefix = slug.slice(0, 180).replace(/-+$/, "");
  return `${rootPath}/${prefix}-source-${await computeHash(
    buildKnowledgeIngestIdentity(source).sourceKey,
  )}.md`;
}

function buildLegacyCustomKnowledgeSlug(source: KnowledgeSource): string {
  return slugifyCustomKnowledgeName(buildCustomKnowledgeName(source, true));
}

/** OKF reserves index.md and log.md for bundle structure. */
export function escapeReservedKnowledgeSlug(slug: string): string {
  return slug === "index" || slug === "log" ? `${slug}-document` : slug;
}

/** Query a writable branch for a current document with this exact source identity. */
export async function findRemoteKnowledgeIngestSource(input: {
  client: ApiClient;
  projectSlug: string;
  branch?: string;
  branchId?: string;
  rootPath: string;
  resource: string;
  legacySource: string;
  sourceKey?: string;
  signal?: AbortSignal;
}): Promise<{ path: string; versionId: string } | undefined> {
  const query = new URLSearchParams();
  if (input.branch !== undefined) query.set("ref", `branch:${input.branch}`);
  if (input.branchId !== undefined) query.set("branch_id", input.branchId);
  const suffix = query.size ? `?${query}` : "";
  input.signal?.throwIfAborted();
  const result = await input.client.post<unknown>(
    `/projects/${encodeURIComponent(input.projectSlug)}/knowledge/ingest-source${suffix}`,
    {
      root_path: input.rootPath,
      resource: input.resource,
      legacy_source: input.legacySource,
      ...(input.sourceKey === undefined ? {} : { source_key: input.sourceKey }),
    },
    input.signal ? { signal: input.signal } : undefined,
  );
  input.signal?.throwIfAborted();
  if (result && typeof result === "object" && "status" in result) {
    if (result.status === "absent") return undefined;
    if (result.status === "ambiguous") {
      throw new Error("Multiple current documents match this knowledge source");
    }
    if (result.status === "unresolved") {
      throw new Error(
        "Cannot establish the current destination for this knowledge source. " +
          "Check the branch index and resolve any existing generated document with an ambiguous source origin.",
      );
    }
    if (
      result.status === "matched" && "path" in result && typeof result.path === "string" &&
      "version_id" in result && typeof result.version_id === "string" && result.version_id
    ) {
      return { path: result.path, versionId: result.version_id };
    }
  }
  throw new Error("Invalid knowledge source lookup response");
}

/** Read a bounded, path-only listing to avoid probing absent collision suffixes individually. */
export async function listRemoteKnowledgeSuffixPaths(input: {
  client: ApiClient;
  projectSlug: string;
  branch?: string;
  branchId?: string;
  stem: string;
  signal?: AbortSignal;
}): Promise<ReadonlySet<string> | undefined> {
  const stem = normalizeKnowledgeInputPath(input.stem);
  // Historical staging names vary by batch. Scope both old allocator forms to
  // this source before asking for a bounded, exhaustive path-only page.
  const patterns = /(?:^|\/)knowledge-ingest-\*-/u.test(stem)
    ? [`${stem}.md`, `${stem}-*.md`]
    : [`${stem}-*.md`];
  const paths = new Set<string>();
  for (const requestedPattern of new Set(patterns)) {
    // Stored paths are unbounded, but the files API caps glob patterns at 1,024
    // characters. Exhaust a bounded prefix family, then let the caller apply
    // its exact full-path/ownership filters before reading document contents.
    const pattern = requestedPattern.length > 1024
      ? `${requestedPattern.slice(0, 1019)}*.md`
      : requestedPattern;
    const params: Record<string, string> = { pattern, fields: "(path)", limit: "100" };
    if (input.branch !== undefined) params.ref = `branch:${input.branch}`;
    else if (input.branchId !== undefined) params.branch_id = input.branchId;
    const page = await input.client.get<{
      data: { path: string }[];
      page_info?: { next: string | null };
    }>(
      `/projects/${encodeURIComponent(input.projectSlug)}/files`,
      params,
      input.signal ? { signal: input.signal } : undefined,
    );
    // A partial response cannot prove absence. Do not inspect a partial family.
    if (page.page_info?.next !== null) return undefined;
    for (const { path } of page.data) paths.add(normalizeKnowledgeInputPath(path));
  }
  return paths;
}

function matchesLegacyCustomKnowledgePath(path: string, basePath: string): boolean {
  const normalized = normalizeKnowledgeInputPath(path);
  const base = normalizeKnowledgeInputPath(basePath);
  if (normalized === base) return true;
  const stem = base.replace(/\.md$/i, "");
  const suffix = normalized.slice(stem.length);
  return normalized.startsWith(stem) && /^-(?:[2-9]|[1-9]\d+)\.md$/.test(suffix);
}

/** Apply the old full-path allocator before removing its synthetic batch prefix. */
function legacyStagedKnowledgeSuffix(source: KnowledgeSource): string {
  const resource = buildKnowledgeIngestIdentity(source).resource;
  const prefix = "knowledge-ingest-legacy";
  const slug = buildLegacyCustomKnowledgeSlug({
    kind: "upload",
    input: resource,
    uploadPath: `uploads/_knowledge-ingest/legacy/${resource}`,
    localPath: source.localPath,
  });
  return slug.slice(prefix.length).replace(/^-/, "");
}

function matchesLegacyStagedKnowledgePath(
  path: string,
  rootPath: string,
  source: KnowledgeSource,
): boolean {
  const suffix = legacyStagedKnowledgeSuffix(source);
  const normalized = normalizeKnowledgeInputPath(path);
  const prefix = `${normalizeKnowledgeInputPath(rootPath)}/knowledge-ingest-`;
  const rootPrefix = normalizeKnowledgeInputPath(rootPath) === "." ? "knowledge-ingest-" : prefix;
  if (!normalized.startsWith(rootPrefix) || !/\.md$/i.test(normalized)) return false;
  const relativeName = normalized.slice(rootPrefix.length);
  // The API glob can cross directories; the historical allocator never did.
  if (relativeName.includes("/")) return false;
  if (!suffix) return true;
  const name = relativeName.replace(/\.md$/i, "");
  return new RegExp(`^.+-${suffix}(?:-(?:[2-9]|[1-9]\\d+))?$`).test(name);
}

// Local directory walking can erase ./ from uploads/... too. These historical
// source/path pairs identify ambiguity to reject, never proof of upload origin.
function matchesAmbiguousLegacyUploadCandidate(input: {
  metadata: Record<string, unknown>;
  path: string;
  rootPath: string;
  source: KnowledgeSource;
  sourceKey?: string;
}): boolean {
  const generated = input.metadata.generated;
  if (
    !generated || typeof generated !== "object" || !("by" in generated) ||
    typeof generated.by !== "string" || !/^veryfront\/\d/.test(generated.by)
  ) return false;
  if ("source_key" in generated || input.source.kind !== "upload") return false;
  const resource = input.metadata.resource;
  const storedSource = resource === undefined ? input.metadata.source : resource;
  if (typeof storedSource !== "string") return false;
  if (resource === undefined) {
    if (
      !storedSource.startsWith("uploads/") ||
      formatKnowledgeUploadSource(storedSource) !== storedSource
    ) return false;
    const stored = { ...input.source, uploadPath: storedSource };
    return buildKnowledgeIngestIdentity(stored).sourceKey === input.sourceKey &&
      matchesLegacyCustomKnowledgePath(
        input.path,
        `${input.rootPath}/${buildLegacyCustomKnowledgeSlug(stored)}.md`,
      );
  }
  // A bare resource names the content, not its origin. Explicit local slugs can
  // imitate every historical staging filename, so naming cannot upgrade it.
  return false;
}

const MAX_KNOWLEDGE_PATH_SUFFIX = 100;

/** A remote path for a generated document and the guard its write must hold. */
export interface ClaimedKnowledgePath {
  remotePath: string;
  expected?: RemoteFileWriteExpectation;
}

/**
 * Pick the remote Markdown path for a generated document. A path already holding
 * another source's document gets a short `-2`, `-3` suffix instead of being overwritten.
 * The returned guard makes the write fail if the path changed after it was read.
 */
export async function claimGeneratedKnowledgePath(input: {
  remotePath: string;
  preferredRemotePath?: string;
  resource: string;
  legacySource: string;
  sourceKey?: string;
  sourceKind?: KnowledgeSource["kind"];
  scanSuffixGaps?: boolean;
  customSource?: KnowledgeSource;
  listSuffixPaths?: (stem: string) => Promise<ReadonlySet<string> | undefined>;
  absenceConflicts: ReadonlyMap<string, unknown>;
  readRemoteFile?: (
    remotePath: string,
  ) => Promise<{ content: string; versionId?: string } | undefined>;
}): Promise<ClaimedKnowledgePath> {
  if (!input.readRemoteFile) return { remotePath: input.remotePath };
  const readRemoteFile = input.readRemoteFile;
  if (input.customSource && !input.listSuffixPaths) {
    throw new Error("Cannot establish custom knowledge ownership without a complete path listing");
  }
  const listFamily = async (stem: string) => {
    const paths = await input.listSuffixPaths?.(normalizeKnowledgeInputPath(stem));
    if (input.customSource && paths === undefined) {
      throw new Error(
        "Cannot establish custom knowledge ownership from an incomplete path listing",
      );
    }
    return paths === undefined ? undefined : new Set([...paths].map(normalizeKnowledgeInputPath));
  };
  const reads = new Map<string, Awaited<ReturnType<typeof readRemoteFile>>>();
  let retained: ClaimedKnowledgePath | undefined;
  const retainOwner = (path: string, existing: { versionId?: string }) => {
    if (!existing.versionId) {
      throw new Error("Cannot update a knowledge path without its current version");
    }
    if (
      retained &&
      normalizeKnowledgeInputPath(retained.remotePath) !== normalizeKnowledgeInputPath(path)
    ) {
      throw new Error("Multiple current documents match this knowledge source");
    }
    for (const conflict of input.absenceConflicts.values()) throw conflict;
    retained = { remotePath: path, expected: { versionId: existing.versionId } };
    return retained;
  };
  const readCandidate = async (path: string) => {
    const normalizedPath = normalizeKnowledgeInputPath(path);
    if (!reads.has(normalizedPath)) reads.set(normalizedPath, await readRemoteFile(path));
    const existing = reads.get(normalizedPath);
    const inspected = existing && inspectOkfDocument(path, existing.content, {
      bundleRoot: input.remotePath.slice(0, input.remotePath.lastIndexOf("/")),
    });
    const metadata = inspected?.metadata;
    const structural = inspected?.envelopeConforms && inspected.kind !== "concept" &&
      metadata?.generated === undefined && metadata?.resource === undefined &&
      metadata?.source === undefined;
    const legacySource = metadata?.resource === undefined ? metadata?.source : undefined;
    const storedKey = metadata && readKnowledgeIngestSourceKey(metadata);
    const storedSource = metadata?.resource === undefined ? legacySource : metadata.resource;
    const sameLocalPath = input.sourceKind === "local" && typeof storedSource === "string" &&
      normalize(storedSource) === normalize(input.resource);
    const legacyMatch = metadata?.resource === input.resource ||
      legacySource === input.legacySource;
    const ambiguousLegacyUploadMatch = metadata !== undefined && input.customSource !== undefined &&
      matchesAmbiguousLegacyUploadCandidate({
        metadata,
        path,
        rootPath: input.remotePath.slice(0, input.remotePath.lastIndexOf("/")),
        source: input.customSource,
        sourceKey: input.sourceKey,
      });
    let sameSource = storedKey !== undefined ? storedKey === input.sourceKey : legacyMatch;
    if (
      input.scanSuffixGaps && storedKey === undefined &&
      (legacyMatch || sameLocalPath || ambiguousLegacyUploadMatch)
    ) {
      const generated = metadata?.generated;
      if (generated && typeof generated === "object" && "source_key" in generated) {
        throw new Error("Cannot establish knowledge ownership from an invalid source key");
      }
      const legacyPath = typeof storedSource === "string"
        ? normalize(storedSource).replaceAll("\\", "/")
        : undefined;
      // Upload references cannot retain an explicit disk prefix or an absolute path.
      // Check the original spelling before normalization removes that evidence.
      const explicitLocalPath = typeof storedSource === "string" &&
        (/^\.{1,2}[\\/]/.test(storedSource) || isAbsolute(storedSource));
      const sourceOnlyLocalPath = metadata?.resource === undefined &&
        legacyPath !== undefined && legacyPath !== "uploads" && !legacyPath.startsWith("uploads/");
      const provableLegacyLocal = sameLocalPath &&
        (explicitLocalPath || sourceOnlyLocalPath) && generated && typeof generated === "object" &&
        "by" in generated && typeof generated.by === "string" &&
        /^veryfront\/\d/.test(generated.by);
      if (!provableLegacyLocal) {
        throw new Error(
          `Cannot update ${path}: the existing document's source origin is ambiguous.`,
        );
      }
      sameSource = true;
    }
    return { existing, metadata, legacySource, sameSource, structural };
  };
  const customPath = input.customSource
    ? await buildCustomKnowledgePath(
      input.customSource,
      input.remotePath.slice(0, input.remotePath.lastIndexOf("/")),
    )
    : undefined;
  if (customPath) {
    if (input.absenceConflicts.has(customPath)) throw input.absenceConflicts.get(customPath);
    const { existing, sameSource } = await readCandidate(customPath);
    if (existing && sameSource) retainOwner(customPath, existing);
  }
  if (input.preferredRemotePath && input.preferredRemotePath !== input.remotePath) {
    const { existing, sameSource } = await readCandidate(input.preferredRemotePath);
    if (existing && sameSource) {
      const owner = retainOwner(input.preferredRemotePath, existing);
      if (!input.scanSuffixGaps) return owner;
    }
  }
  const stem = input.remotePath.replace(/\.md$/i, "");
  let firstAbsent: string | undefined;
  let listedSuffixPaths: ReadonlySet<string> | undefined;
  for (let attempt = 1; attempt <= MAX_KNOWLEDGE_PATH_SUFFIX + 1; attempt += 1) {
    let candidate = input.remotePath;
    if (attempt > MAX_KNOWLEDGE_PATH_SUFFIX) {
      // A crowded title can still accept another source without an unbounded probe.
      const sourceDigest = await computeHash(input.resource);
      candidate = `${stem}-source-${sourceDigest.slice(0, CUSTOM_SOURCE_HASH_LENGTH)}.md`;
    } else if (attempt > 1) {
      candidate = `${stem}-${attempt}.md`;
    }
    if (listedSuffixPaths && !listedSuffixPaths.has(normalizeKnowledgeInputPath(candidate))) {
      continue;
    }
    const { existing, metadata, legacySource, sameSource } = await readCandidate(candidate);
    if (
      input.absenceConflicts.has(candidate) &&
      (sameSource || (typeof metadata?.resource !== "string" && typeof legacySource !== "string"))
    ) {
      throw input.absenceConflicts.get(candidate);
    }
    if (!existing) {
      if (!input.scanSuffixGaps) return { remotePath: candidate, expected: { absent: true } };
      if (firstAbsent === undefined) {
        firstAbsent = candidate;
        listedSuffixPaths = await listFamily(stem);
      }
      continue;
    }
    if (sameSource) {
      const owner = retainOwner(candidate, existing);
      if (!input.scanSuffixGaps) return owner;
      if (listedSuffixPaths === undefined && input.listSuffixPaths) {
        listedSuffixPaths = await listFamily(stem);
      }
    }
  }
  if (input.customSource && listedSuffixPaths === undefined) {
    listedSuffixPaths = await listFamily(stem);
  }
  // Listings can contain historical numeric suffixes beyond today's allocator
  // range. Inspect those actual paths too before choosing any custom owner.
  if (input.scanSuffixGaps && listedSuffixPaths) {
    if (listedSuffixPaths.size > MAX_KNOWLEDGE_PATH_SUFFIX) {
      throw new Error("Too many knowledge paths to establish a unique source");
    }
    for (const candidate of listedSuffixPaths) {
      if (!matchesLegacyCustomKnowledgePath(candidate, input.remotePath)) continue;
      const { existing, sameSource } = await readCandidate(candidate);
      if (existing && sameSource) retainOwner(candidate, existing);
    }
  }
  if (firstAbsent !== undefined || retained !== undefined || input.customSource !== undefined) {
    if (input.customSource !== undefined) {
      const rootPath = input.remotePath.slice(0, input.remotePath.lastIndexOf("/"));
      const staged = input.customSource.kind === "upload" &&
        KNOWLEDGE_INGEST_STAGING_RE.test(buildSourceReference(input.customSource));
      if (staged && rootPath.includes("*")) {
        throw new Error(
          "Cannot scope legacy staging discovery to a destination containing a wildcard",
        );
      }
      const legacyStem = `${rootPath}/${buildLegacyCustomKnowledgeSlug(input.customSource)}`;
      const candidates = new Set<string>();
      let unlistedLegacyFamily = false;
      const addFamily = async (stem: string) => {
        candidates.add(`${normalizeKnowledgeInputPath(stem)}.md`);
        if (input.listSuffixPaths) {
          const paths = await input.listSuffixPaths(normalizeKnowledgeInputPath(stem));
          if (paths === undefined) {
            throw new Error(
              "Cannot establish legacy knowledge ownership from an incomplete path listing",
            );
          }
          for (const path of paths) {
            if (matchesLegacyCustomKnowledgePath(path, `${stem}.md`)) {
              candidates.add(normalizeKnowledgeInputPath(path));
            }
          }
        } else unlistedLegacyFamily = true;
      };
      if (
        normalizeKnowledgeInputPath(`${legacyStem}.md`) !==
          normalizeKnowledgeInputPath(input.remotePath)
      ) {
        await addFamily(legacyStem);
      }
      if (staged) {
        if (!input.listSuffixPaths) {
          throw new Error(
            "Cannot establish legacy staged knowledge ownership without a complete path listing",
          );
        }
        const legacySuffix = legacyStagedKnowledgeSuffix(input.customSource);
        // When legacy slugging erased the resource, only a bounded complete
        // family can recover a typed key or an exact old generated source.
        const paths = await input.listSuffixPaths(
          normalizeKnowledgeInputPath(
            legacySuffix
              ? `${rootPath}/knowledge-ingest-*-${legacySuffix}`
              : `${rootPath}/knowledge-ingest`,
          ),
        );
        if (paths === undefined) {
          throw new Error(
            "Cannot establish legacy knowledge ownership from an incomplete path listing",
          );
        }
        for (const path of paths) {
          if (matchesLegacyStagedKnowledgePath(path, rootPath, input.customSource)) {
            candidates.add(normalizeKnowledgeInputPath(path));
          }
        }
      }
      if (candidates.size > MAX_KNOWLEDGE_PATH_SUFFIX) {
        throw new Error("Too many legacy knowledge paths to establish a unique source");
      }
      for (const candidate of candidates) {
        const { existing, sameSource, metadata, structural } = await readCandidate(candidate);
        if (!existing || structural) continue;
        if (sameSource) {
          retainOwner(candidate, existing);
        } else if (
          metadata === undefined ||
          (typeof metadata.resource !== "string" &&
            !(metadata.resource === undefined && typeof metadata.source === "string")) ||
          (metadata.generated && typeof metadata.generated === "object" &&
            "source_key" in metadata.generated &&
            typeof metadata.generated.source_key !== "string")
        ) {
          throw new Error(
            "Cannot establish the source origin of an existing legacy knowledge path",
          );
        }
      }
      if (unlistedLegacyFamily) {
        throw new Error(
          "Cannot establish legacy knowledge ownership without a complete path listing",
        );
      }
    }
    if (retained) return retained;
    if (customPath) {
      const { existing } = await readCandidate(customPath);
      if (existing) {
        throw new Error(
          "Cannot allocate the deterministic knowledge path: another or unverified source occupies it",
        );
      }
      return { remotePath: customPath, expected: { absent: true } };
    }
    if (firstAbsent !== undefined) return { remotePath: firstAbsent, expected: { absent: true } };
  }
  throw new Error(`No free knowledge path for ${input.remotePath}`);
}

export function deriveKnowledgeRemotePath(
  outputPath: string,
  outputDir: string,
  knowledgePath: string,
): string {
  const relativeOutputPath = relative(outputDir, outputPath).replaceAll("\\", "/");
  if (!relativeOutputPath || relativeOutputPath.startsWith("..")) {
    throw new Error(`Output path is outside output directory: ${outputPath}`);
  }
  const prefix = normalizeKnowledgeInputPath(knowledgePath);
  const normalizedRelative = normalizeKnowledgeRelativePath(relativeOutputPath);
  return `${prefix}/${normalizedRelative}`.replaceAll("\\", "/");
}

export function createKnowledgeIngestResult(input: {
  source: string;
  localSourcePath: string;
  outputPath: string;
  remotePath: string;
  parser: {
    slug: string;
    stats: Record<string, unknown>;
    warnings: string[];
    source_type: string;
    summary: string;
    document_kind?: KnowledgeIngestFileResult["documentKind"];
    okf?: KnowledgeIngestFileResult["okf"];
  };
}): KnowledgeIngestFileResult {
  return {
    source: input.source,
    localSourcePath: input.localSourcePath,
    outputPath: input.outputPath,
    remotePath: input.remotePath,
    slug: input.parser.slug,
    sourceType: input.parser.source_type,
    summary: input.parser.summary,
    stats: input.parser.stats,
    warnings: input.parser.warnings,
    ...(input.parser.document_kind === undefined
      ? {}
      : { documentKind: input.parser.document_kind }),
    ...(input.parser.okf === undefined ? {} : { okf: input.parser.okf }),
  };
}
