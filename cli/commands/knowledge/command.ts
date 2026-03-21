import { z } from "zod";
import { createFileSystem, getEnv } from "veryfront/platform";
import { basename, extname, join, normalize, relative } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import { cliLogger } from "#cli/utils";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { downloadUploadToFile, listAllUploads, type UploadItem } from "../uploads/command.ts";
import { putRemoteFileFromLocal } from "../files/command.ts";
import { knowledgeIngestPythonSource } from "./parser-source.ts";
import { createJobUserLogger, type Logger, serverLogger } from "veryfront/utils";
import { writeJobResultIfConfigured } from "../../utils/write-job-result.ts";
import { classifyKnowledgeDirectoryPath, classifyKnowledgeSourcePath } from "./source-policy.ts";
import {
  buildKnowledgeIngestJobResult,
  type KnowledgeIngestFailedFileResult,
  type KnowledgeIngestFileResult,
  type KnowledgeIngestSkippedFileResult,
} from "./result.ts";

export interface KnowledgeParserResult {
  success: true;
  source_path: string;
  source_filename: string;
  source_type: string;
  slug: string;
  sandbox_output_path: string;
  suggested_project_path: string;
  description: string;
  title: string;
  summary: string;
  stats: Record<string, unknown>;
  warnings: string[];
}

type KnowledgeSource =
  | { kind: "local"; input: string; localPath: string }
  | { kind: "upload"; input: string; uploadPath: string; localPath: string };

export interface KnowledgeSourceCollection {
  sources: KnowledgeSource[];
  skipped: KnowledgeIngestSkippedFileResult[];
}

type DownloadResult = { uploadPath: string; localPath: string; bytes?: number };

const knowledgeJobLogger = serverLogger.component("knowledge-ingest");

const KnowledgeIngestArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  sources: z.array(z.string()).default([]),
  path: z.string().optional(),
  all: z.boolean().default(false),
  recursive: z.boolean().default(false),
  outputDir: z.string().optional(),
  knowledgePath: z.string().default("knowledge"),
  description: z.string().optional(),
  slug: z.string().optional(),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
}).superRefine((value, ctx) => {
  const hasExplicitSources = value.sources.length > 0;
  const hasPath = typeof value.path === "string" && value.path.length > 0;

  if (hasExplicitSources && (hasPath || value.all)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use either explicit source paths or --path with --all, not both.",
    });
  }

  if (!hasExplicitSources && !hasPath && !value.all) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide one or more source paths or use --path with --all.",
    });
  }

  if (hasPath && !value.all) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "--path requires --all.",
    });
  }

  if (!hasPath && value.all) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "--all requires --path.",
    });
  }

  if (value.slug && value.sources.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "--slug can only be used with a single explicit source.",
    });
  }
});

export type KnowledgeIngestOptions = z.infer<typeof KnowledgeIngestArgsSchema>;

function getStringArg(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function getBooleanArg(args: ParsedArgs, ...keys: string[]): boolean {
  return keys.some((key) => Boolean(args[key]));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function createKnowledgeIngestEventLogger(): Logger | null {
  const projectId = getEnv("TENANT_PROJECT_ID");
  const jobId = getEnv("JOB_ID");

  if (!projectId || !jobId) {
    return null;
  }

  return createJobUserLogger(knowledgeJobLogger, {
    projectId,
    jobId,
    batchId: getEnv("JOB_BATCH_ID") ?? undefined,
    jobTarget: getEnv("JOB_TARGET") ?? undefined,
    task: "knowledge-ingest",
  });
}

function buildKnowledgeSourceName(source: KnowledgeSource): string {
  return basename(source.kind === "upload" ? source.uploadPath : source.localPath);
}

function showKnowledgeUsage(): void {
  console.log(`
Veryfront Knowledge

Usage:
  veryfront knowledge ingest <source...> [options]
  veryfront knowledge ingest --path <prefix-or-dir> --all [options]

Subcommands:
  ingest   Orchestrate upload resolution, parsing, and knowledge file writes
`);
}

export function parseKnowledgeIngestArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, KnowledgeIngestOptions> {
  return KnowledgeIngestArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    sources: args._.slice(2).filter((value): value is string => typeof value === "string"),
    path: getStringArg(args, "path"),
    all: getBooleanArg(args, "all"),
    recursive: getBooleanArg(args, "recursive"),
    outputDir: getStringArg(args, "output-dir"),
    knowledgePath: getStringArg(args, "knowledge-path") ?? "knowledge",
    description: getStringArg(args, "description", "desc"),
    slug: getStringArg(args, "slug"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function normalizeKnowledgeInputPath(inputPath: string): string {
  const normalizedPath = normalize(inputPath).replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalizedPath || normalizedPath.startsWith("..") || normalizedPath.startsWith("/")) {
    throw new Error(`Invalid knowledge input path: ${inputPath}`);
  }
  return normalizedPath;
}

export function normalizeProjectUploadPath(inputPath: string): string {
  const normalizedPath = normalizeKnowledgeInputPath(inputPath);
  return normalizedPath === "uploads" ? "" : normalizedPath.replace(/^uploads\/+/, "");
}

export function formatKnowledgeUploadSource(uploadPath: string): string {
  const normalizedPath = normalizeKnowledgeInputPath(uploadPath);
  return normalizedPath === "uploads" || normalizedPath.startsWith("uploads/")
    ? normalizedPath
    : `uploads/${normalizedPath}`;
}

function resolveExplicitUploadPath(inputPath: string): string {
  const normalizedInput = normalizeKnowledgeInputPath(inputPath);
  const displayInput = inputPath.replace(/\\/g, "/");
  const uploadPath = normalizeProjectUploadPath(inputPath);
  if (!uploadPath || normalizedInput.endsWith("/")) {
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

function isProjectUploadReference(value: string): boolean {
  if (isLikelyLocalPath(value)) return false;
  const normalizedValue = normalize(value).replace(/\\/g, "/").replace(/^\/+/, "");
  return normalizedValue === "uploads" || normalizedValue.startsWith("uploads/");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function defaultOutputRoot(): Promise<string> {
  return Deno.makeTempDir({ prefix: "veryfront-knowledge-" });
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

function createFailedKnowledgeSource(input: {
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

function classifyDirectoryOrSkip(input: {
  source: string;
}): KnowledgeIngestSkippedFileResult | null {
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

async function collectLocalFiles(
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

function buildSourceReference(source: KnowledgeSource): string {
  return source.kind === "upload"
    ? formatKnowledgeUploadSource(source.uploadPath)
    : source.localPath;
}

function buildSuggestedSlug(source: KnowledgeSource, index: number): string {
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

  return slugify(stripped || basename(normalized, extname(normalized)) || `document-${index + 1}`);
}
function ensureUniqueSlugs(sources: KnowledgeSource[]): string[] {
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
  parser: Pick<KnowledgeParserResult, "slug" | "stats" | "warnings" | "source_type" | "summary">;
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

export async function runKnowledgeParser(input: {
  filePath: string;
  outputDir: string;
  description?: string;
  slug?: string;
  sourceReference?: string;
  env?: Record<string, string>;
}): Promise<KnowledgeParserResult> {
  const tempDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-parser-" });
  const inputJsonPath = `${tempDir}/input.json`;
  const outputJsonPath = `${tempDir}/output.json`;
  const scriptPath = `${tempDir}/ingest_document_to_knowledge.py`;

  try {
    try {
      await Deno.writeTextFile(
        inputJsonPath,
        JSON.stringify({
          file_path: input.filePath,
          output_dir: input.outputDir,
          description: input.description,
          slug: input.slug,
          source_reference: input.sourceReference,
        }),
      );
      await Deno.writeTextFile(scriptPath, knowledgeIngestPythonSource);

      let result: Deno.CommandOutput;
      try {
        result = await new Deno.Command("python3", {
          args: [scriptPath, "--input-json", inputJsonPath, "--output-json", outputJsonPath],
          ...(input.env ? { env: input.env } : {}),
          stdout: "piped",
          stderr: "piped",
        }).output();
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new Error(
            "python3 is required. Install python3 and the supported parser packages, or run the command inside the Veryfront sandbox.",
          );
        }
        throw error;
      }

      if (result.code !== 0) {
        const stderr = new TextDecoder().decode(result.stderr).trim();
        throw new Error(stderr || "parser exited unsuccessfully");
      }

      const raw = await Deno.readTextFile(outputJsonPath);
      return JSON.parse(raw) as KnowledgeParserResult;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("knowledge ingest parser failed")) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`knowledge ingest parser failed: ${message}`);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
}

export async function collectKnowledgeSources(
  options: Pick<KnowledgeIngestOptions, "sources" | "path" | "all" | "recursive">,
  deps: {
    client: ApiClient;
    projectSlug: string;
    downloadUploads: (uploadPaths: string[]) => Promise<DownloadResult[]>;
  },
): Promise<KnowledgeSourceCollection> {
  const fs = createFileSystem();

  if (options.sources.length > 0) {
    const explicitSources: Array<
      | { kind: "local"; collection: KnowledgeSourceCollection }
      | { kind: "upload"; input: string; uploadPath: string }
    > = [];
    const uploadTargets: string[] = [];
    const skipped: KnowledgeIngestSkippedFileResult[] = [];

    for (const input of options.sources) {
      if (!isProjectUploadReference(input) && await fs.exists(input)) {
        const collection = await collectLocalFiles(input, options.recursive);
        explicitSources.push({
          kind: "local",
          collection,
        });
        continue;
      }

      if (isLikelyLocalPath(input)) {
        throw new Error(`Local file not found: ${input}`);
      }

      const uploadPath = resolveExplicitUploadPath(input);
      const skippedUpload = classifySourceOrSkip({
        source: formatKnowledgeUploadSource(uploadPath),
      });
      if (skippedUpload != null) {
        skipped.push(skippedUpload);
        continue;
      }

      explicitSources.push({ kind: "upload", input, uploadPath });
      uploadTargets.push(uploadPath);
    }

    const downloads = uploadTargets.length > 0 ? await deps.downloadUploads(uploadTargets) : [];
    const downloadsByPath = new Map<string, DownloadResult[]>();

    for (const download of downloads) {
      const existing = downloadsByPath.get(download.uploadPath) ?? [];
      existing.push(download);
      downloadsByPath.set(download.uploadPath, existing);
    }

    const resolvedSources: KnowledgeSource[] = [];
    for (const source of explicitSources) {
      if (source.kind === "local") {
        for (const localSource of source.collection.sources) {
          resolvedSources.push({
            kind: "local",
            input: localSource.input,
            localPath: localSource.localPath,
          });
        }
        skipped.push(...source.collection.skipped);
        continue;
      }

      const matchingDownloads = downloadsByPath.get(source.uploadPath);
      const download = matchingDownloads?.shift();
      if (!download) {
        throw new Error(`Upload not found: ${formatKnowledgeUploadSource(source.uploadPath)}`);
      }

      resolvedSources.push({
        kind: "upload",
        input: source.input,
        uploadPath: download.uploadPath,
        localPath: download.localPath,
      });
    }

    return {
      sources: resolvedSources,
      skipped,
    };
  }

  if (!options.path || !options.all) {
    throw new Error("Provide one or more source paths or use --path with --all.");
  }

  if (!isProjectUploadReference(options.path) && await fs.exists(options.path)) {
    return collectLocalFiles(options.path, options.recursive);
  }

  const displayUploadPrefix = normalizeKnowledgeInputPath(options.path);
  const uploadPrefix = normalizeProjectUploadPath(options.path);

  const listUploadsForPrefix = async (pathPrefix?: string): Promise<UploadItem[]> =>
    listAllUploads(deps.client, deps.projectSlug, {
      path: pathPrefix || undefined,
      recursive: options.recursive ?? true,
      limit: 100,
    });

  let uploads = await listUploadsForPrefix(uploadPrefix || undefined);
  let skipped = uploads.flatMap((item: UploadItem) => {
    if (item.type === "folder") {
      return [];
    }

    const skippedUpload = classifySourceOrSkip({
      source: formatKnowledgeUploadSource(item.path),
    });
    return skippedUpload == null ? [] : [skippedUpload];
  });
  let uploadTargets = uploads
    .filter((item: UploadItem) => item.type !== "folder")
    .map((item: UploadItem) => item.path)
    .filter((uploadPath) =>
      classifySourceOrSkip({ source: formatKnowledgeUploadSource(uploadPath) }) == null
    );

  if (!uploadTargets.length && uploadPrefix && !uploadPrefix.endsWith("/")) {
    uploads = await listUploadsForPrefix(`${uploadPrefix}/`);
    skipped = uploads.flatMap((item: UploadItem) => {
      if (item.type === "folder") {
        return [];
      }

      const skippedUpload = classifySourceOrSkip({
        source: formatKnowledgeUploadSource(item.path),
      });
      return skippedUpload == null ? [] : [skippedUpload];
    });
    uploadTargets = uploads
      .filter((item: UploadItem) => item.type !== "folder")
      .map((item: UploadItem) => item.path)
      .filter((uploadPath) =>
        classifySourceOrSkip({ source: formatKnowledgeUploadSource(uploadPath) }) == null
      );
  }

  if (!uploadTargets.length && skipped.length === 0) {
    throw new Error(`No supported uploads found under ${displayUploadPrefix}`);
  }

  const downloads = await deps.downloadUploads(uploadTargets);
  return {
    sources: downloads.map((download) => ({
      kind: "upload",
      input: options.path!,
      uploadPath: download.uploadPath,
      localPath: download.localPath,
    })),
    skipped,
  };
}

export async function ingestResolvedSources(
  sources: KnowledgeSource[],
  options: KnowledgeIngestOptions,
  deps: {
    client: ApiClient;
    projectSlug: string;
    outputDir: string;
    runParser: typeof runKnowledgeParser;
    uploadKnowledgeFile: (remotePath: string, localPath: string) => Promise<{ path: string }>;
    eventLogger?: Logger | null;
  },
): Promise<{
  ingested: KnowledgeIngestFileResult[];
  failed: KnowledgeIngestFailedFileResult[];
}> {
  if (options.slug && sources.length !== 1) {
    throw new Error("--slug can only be used with a single explicit source.");
  }

  const slugs = options.slug ? [options.slug] : ensureUniqueSlugs(sources);
  const ingested: KnowledgeIngestFileResult[] = [];
  const failed: KnowledgeIngestFailedFileResult[] = [];

  for (const [index, source] of sources.entries()) {
    const sourceReference = buildSourceReference(source);

    deps.eventLogger?.info("Processing knowledge source", {
      phase: "file_processing",
      progress_current: index + 1,
      progress_total: sources.length,
      source_name: buildKnowledgeSourceName(source),
    });

    try {
      const parser = await deps.runParser({
        filePath: source.localPath,
        outputDir: deps.outputDir,
        description: options.description,
        slug: slugs[index],
        sourceReference,
      });
      const remotePath = deriveKnowledgeRemotePath(
        parser.sandbox_output_path,
        deps.outputDir,
        options.knowledgePath,
      );
      const uploaded = await deps.uploadKnowledgeFile(remotePath, parser.sandbox_output_path);

      deps.eventLogger?.info("Knowledge source ingested", {
        phase: "file_completed",
        progress_current: index + 1,
        progress_total: sources.length,
        source_name: buildKnowledgeSourceName(source),
        remote_path: uploaded.path,
        warning_count: parser.warnings.length,
      });

      if (parser.warnings.length > 0) {
        deps.eventLogger?.warn("Knowledge source emitted warnings", {
          phase: "file_warning",
          progress_current: index + 1,
          progress_total: sources.length,
          source_name: buildKnowledgeSourceName(source),
          warning_count: parser.warnings.length,
        });
      }

      ingested.push(
        createKnowledgeIngestResult({
          source: sourceReference,
          localSourcePath: source.localPath,
          outputPath: parser.sandbox_output_path,
          remotePath: uploaded.path,
          parser,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = message.startsWith("knowledge ingest parser failed")
        ? "parser_error"
        : "upload_error";

      deps.eventLogger?.error("Knowledge source failed", {
        phase: "file_failed",
        progress_current: index + 1,
        progress_total: sources.length,
        source_name: buildKnowledgeSourceName(source),
        error: message,
      });

      failed.push(createFailedKnowledgeSource({
        source: sourceReference,
        localSourcePath: source.localPath,
        message,
        reason,
      }));
    }
  }

  return {
    ingested,
    failed,
  };
}

export async function knowledgeCommand(args: ParsedArgs): Promise<void> {
  const subcommand = typeof args._[1] === "string" ? args._[1] : undefined;

  if (!subcommand || subcommand === "help") {
    showKnowledgeUsage();
    return;
  }

  await withSpan("cli.command.knowledge", async () => {
    switch (subcommand) {
      case "ingest": {
        const parsed = parseKnowledgeIngestArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid knowledge ingest arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        const outputDir = options.outputDir ?? await defaultOutputRoot();
        const shouldCleanupOutputDir = options.outputDir === undefined;
        const downloadOutputDir = resolveKnowledgeDownloadOutputDir(outputDir);
        const eventLogger = createKnowledgeIngestEventLogger();

        try {
          const sourceMode = options.path ? "path_prefix" : "explicit_sources";

          eventLogger?.info("Starting knowledge ingest", {
            phase: "started",
            mode: sourceMode,
          });

          const collection = await collectKnowledgeSources(options, {
            client,
            projectSlug: config.projectSlug,
            downloadUploads: (uploadPaths) =>
              Promise.all(
                uploadPaths.map((uploadPath) =>
                  downloadUploadToFile(client, config.projectSlug, uploadPath, downloadOutputDir)
                ),
              ),
          });
          const requestedCount = collection.sources.length + collection.skipped.length;
          if (requestedCount === 0) {
            throw new Error("No supported knowledge sources were found.");
          }

          eventLogger?.info("Resolved knowledge sources", {
            phase: "sources_resolved",
            progress_total: requestedCount,
            ingestable_count: collection.sources.length,
            skipped_count: collection.skipped.length,
          });
          if (collection.skipped.length > 0) {
            eventLogger?.warn("Skipped knowledge sources", {
              phase: "sources_skipped",
              skipped_count: collection.skipped.length,
            });
          }

          const results = await ingestResolvedSources(collection.sources, options, {
            client,
            projectSlug: config.projectSlug,
            outputDir,
            runParser: runKnowledgeParser,
            eventLogger,
            uploadKnowledgeFile: (remotePath, localPath) =>
              putRemoteFileFromLocal(client, config.projectSlug, remotePath, localPath),
          });
          const jobResult = buildKnowledgeIngestJobResult({
            requestedCount,
            sourceMode,
            knowledgePath: options.knowledgePath,
            ingested: results.ingested,
            skipped: collection.skipped,
            failed: results.failed,
          });

          eventLogger?.info("Completed knowledge ingest", {
            phase: "completed",
            progress_current: requestedCount,
            progress_total: requestedCount,
            ingested_count: jobResult.summary.ingested_count,
            skipped_count: jobResult.summary.skipped_count,
            failed_count: jobResult.summary.failed_count,
          });

          await writeJobResultIfConfigured(jobResult);

          if (options.json) {
            printJson(jobResult);
            return;
          }

          for (const result of jobResult.ingested) {
            if (!options.quiet) {
              cliLogger.info(`Ingested ${result.source} -> ${result.remotePath}`);
              cliLogger.info(`  ${result.summary}`);
            }
          }

          for (const skipped of jobResult.skipped) {
            if (!options.quiet) {
              cliLogger.warn(`Skipped ${skipped.source}`);
              cliLogger.warn(`  ${skipped.message}`);
            }
          }

          for (const failure of jobResult.failed) {
            if (!options.quiet) {
              cliLogger.error(`Failed ${failure.source}`);
              cliLogger.error(`  ${failure.message}`);
            }
          }
        } catch (error) {
          eventLogger?.error("Knowledge ingest failed", {
            phase: "failed",
          });
          throw error;
        } finally {
          if (shouldCleanupOutputDir) {
            await Promise.all([
              Deno.remove(outputDir, { recursive: true }).catch(() => undefined),
              Deno.remove(downloadOutputDir, { recursive: true }).catch(() => undefined),
            ]);
          }
        }
        return;
      }

      default:
        showKnowledgeUsage();
    }
  });
}
