import { createFileSystem } from "veryfront/platform";
import { basename, extname, join, normalize, relative } from "veryfront/platform/path";
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

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

const CHAT_UPLOAD_PREFIX_RE =
  /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+-[a-z0-9]+-/i;

export function normalizeKnowledgeInputPath(inputPath: string): string {
  const normalizedPath = normalize(inputPath).replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalizedPath || normalizedPath.startsWith("..") || normalizedPath.startsWith("/")) {
    throw new Error(`Invalid knowledge input path: ${inputPath}`);
  }
  return normalizedPath;
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
  const displayInput = inputPath.replace(/\\/g, "/");
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
  const normalizedValue = normalize(value).replace(/\\/g, "/").replace(/^\/+/, "");
  return normalizedValue === "uploads" || normalizedValue.startsWith("uploads/");
}

export function stripChatUploadPrefix(name: string): string {
  return name.replace(CHAT_UPLOAD_PREFIX_RE, "");
}

export function resolveKnowledgeDownloadOutputDir(outputDir: string): string {
  return join(outputDir, ".uploads");
}

function createSkippedKnowledgeSource(input: {
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
  input: { source: string },
): KnowledgeIngestSkippedFileResult | null {
  const decision = classifyKnowledgeDirectoryPath(input.source);
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
): Promise<KnowledgeSourceCollection> {
  const fs = createFileSystem();
  const stat = await fs.stat(root);
  if (stat.isFile) {
    const skipped = classifySourceOrSkip({ source: root, localSourcePath: root });
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

  const skippedRootDirectory = classifyDirectoryOrSkip({ source: root });
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
        const skipped = classifyDirectoryOrSkip({ source: entryPath });
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

      const skipped = classifySourceOrSkip({ source: entryPath, localSourcePath: entryPath });
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

export function buildSuggestedSlug(source: KnowledgeSource, index: number): string {
  const normalized = normalize(
    source.kind === "upload" ? source.uploadPath : source.localPath,
  ).replace(/\\/g, "/");

  let stripped: string;
  if (source.kind === "upload") {
    stripped = normalized
      .replace(/^\/workspace\/uploads\//, "")
      .replace(/^\/workspace\//, "")
      .replace(/^uploads\//, "")
      .replace(/\.[^.]+$/, "");
  } else if (normalized.startsWith("/workspace/uploads/")) {
    stripped = normalized.replace(/^\/workspace\/uploads\//, "").replace(/\.[^.]+$/, "");
  } else if (normalized.startsWith("/workspace/")) {
    stripped = normalized.replace(/^\/workspace\//, "").replace(/\.[^.]+$/, "");
  } else if (normalized.startsWith("/")) {
    stripped = basename(normalized, extname(normalized));
  } else {
    stripped = normalized.replace(/\.[^.]+$/, "");
  }

  const lastSlash = stripped.lastIndexOf("/");
  if (lastSlash >= 0) {
    const dir = stripped.slice(0, lastSlash + 1);
    const file = stripChatUploadPrefix(stripped.slice(lastSlash + 1));
    stripped = file ? `${dir}${file}` : stripped;
  } else {
    stripped = stripChatUploadPrefix(stripped) || stripped;
  }

  return slugify(stripped || basename(normalized, extname(normalized)) || `document-${index + 1}`);
}

export function ensureUniqueSlugs(sources: KnowledgeSource[]): string[] {
  const counts = new Map<string, number>();
  return sources.map((source, index) => {
    const baseSlug = buildSuggestedSlug(source, index);
    const nextCount = (counts.get(baseSlug) ?? 0) + 1;
    counts.set(baseSlug, nextCount);
    return nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`;
  });
}

export function deriveKnowledgeRemotePath(
  outputPath: string,
  outputDir: string,
  knowledgePath: string,
): string {
  const relativeOutputPath = relative(outputDir, outputPath).replace(/\\/g, "/");
  if (!relativeOutputPath || relativeOutputPath.startsWith("..")) {
    throw new Error(`Output path is outside output directory: ${outputPath}`);
  }
  const prefix = normalizeKnowledgeInputPath(knowledgePath);
  const normalizedRelative = normalize(relativeOutputPath).replace(/^\/+/, "");
  return `${prefix}/${normalizedRelative}`.replace(/\\/g, "/");
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
  };
}
