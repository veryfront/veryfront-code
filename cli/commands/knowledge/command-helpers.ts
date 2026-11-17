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

/** Keep generated files at the source-derived paths used by custom destinations. */
export async function buildCustomKnowledgeSlug(source: KnowledgeSource): Promise<string> {
  const stagedReference = source.kind === "upload"
    ? KNOWLEDGE_INGEST_STAGING_RE.exec(buildSourceReference(source))?.[1]
    : undefined;
  const sourcePath = source.kind === "upload" ? source.uploadPath : source.localPath;
  const normalized = normalize(stagedReference ?? sourcePath).replaceAll("\\", "/");

  let stem: string;
  if (stagedReference !== undefined) {
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
  } else if (isAbsolute(normalized)) {
    stem = basename(normalized, extname(normalized));
  } else {
    stem = normalized.replace(/\.[^.]+$/, "");
  }

  const lastSlash = stem.lastIndexOf("/");
  const directory = stem.slice(0, lastSlash + 1);
  const filename = stripChatUploadPrefix(stem.slice(lastSlash + 1));
  const name = `${directory}${filename}` || basename(normalized, extname(normalized));
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|(?<!-)-+$/g, "") ||
    "document";
  if (slug.length <= MAX_CUSTOM_SLUG_LENGTH) return escapeReservedKnowledgeSlug(slug);
  const prefix = slug.slice(0, MAX_CUSTOM_SLUG_LENGTH - CUSTOM_SOURCE_HASH_LENGTH - 1)
    .replace(/-+$/, "");
  return `${prefix}-${(await computeHash(name)).slice(0, CUSTOM_SOURCE_HASH_LENGTH)}`;
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
  const params: Record<string, string> = {
    pattern: `${normalizeKnowledgeInputPath(input.stem)}-*.md`,
    fields: "(path)",
    limit: "100",
  };
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
  // A partial response cannot prove absence. The caller can probe exact allocator paths instead.
  if (page.page_info?.next !== null) return undefined;
  return new Set(page.data.map(({ path }) => normalizeKnowledgeInputPath(path)));
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
  listSuffixPaths?: (stem: string) => Promise<ReadonlySet<string> | undefined>;
  absenceConflicts: ReadonlyMap<string, unknown>;
  readRemoteFile?: (
    remotePath: string,
  ) => Promise<{ content: string; versionId?: string } | undefined>;
}): Promise<ClaimedKnowledgePath> {
  if (!input.readRemoteFile) return { remotePath: input.remotePath };
  const readRemoteFile = input.readRemoteFile;
  const readCandidate = async (path: string) => {
    const existing = await readRemoteFile(path);
    const metadata = existing && inspectOkfDocument(path, existing.content).metadata;
    const legacySource = metadata?.resource === undefined ? metadata?.source : undefined;
    const storedKey = metadata && readKnowledgeIngestSourceKey(metadata);
    const storedSource = metadata?.resource === undefined ? legacySource : metadata.resource;
    const sameLocalPath = input.sourceKind === "local" && typeof storedSource === "string" &&
      normalize(storedSource) === normalize(input.resource);
    const legacyMatch = metadata?.resource === input.resource ||
      legacySource === input.legacySource;
    let sameSource = storedKey !== undefined ? storedKey === input.sourceKey : legacyMatch;
    if (input.scanSuffixGaps && storedKey === undefined && (legacyMatch || sameLocalPath)) {
      const generated = metadata?.generated;
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
    return { existing, metadata, legacySource, sameSource };
  };
  if (input.preferredRemotePath && input.preferredRemotePath !== input.remotePath) {
    const { existing, sameSource } = await readCandidate(input.preferredRemotePath);
    if (existing?.versionId && sameSource) {
      return { remotePath: input.preferredRemotePath, expected: { versionId: existing.versionId } };
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
        const paths = await input.listSuffixPaths?.(normalizeKnowledgeInputPath(stem));
        listedSuffixPaths = paths === undefined
          ? undefined
          : new Set([...paths].map(normalizeKnowledgeInputPath));
      }
      continue;
    }
    if (existing.versionId && sameSource) {
      return { remotePath: candidate, expected: { versionId: existing.versionId } };
    }
  }
  if (firstAbsent !== undefined) return { remotePath: firstAbsent, expected: { absent: true } };
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
