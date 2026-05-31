import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
type SafeParseResult<T> = { success: true; data: T } | {
  success: false;
  error: Error & { issues: unknown[] };
};
import { createFileSystem, getEnv } from "veryfront/platform";
import { basename } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import { cliLogger } from "#cli/utils";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { getStringArg } from "../../shared/parsed-args.ts";
import { downloadUploadToFile, listAllUploads, type UploadItem } from "../uploads/command.ts";
import { putRemoteFileFromLocal } from "../files/command.ts";
import * as commandHelpers from "./command-helpers.ts";
import { createRunUserLogger, type Logger, serverLogger } from "veryfront/utils";
import { writeRunResultIfConfigured } from "../../utils/write-run-result.ts";
import { classifyKnowledgeSourcePath } from "./source-policy.ts";
import { type KnowledgeParserResult, runKnowledgeParser } from "./parser.ts";
import {
  buildKnowledgeIngestRunResult,
  type KnowledgeIngestFailedFileResult,
  type KnowledgeIngestFailureReason,
  type KnowledgeIngestFileResult,
  type KnowledgeIngestSkippedFileResult,
} from "./result.ts";
type KnowledgeSource =
  | { kind: "local"; input: string; localPath: string }
  | { kind: "upload"; input: string; uploadPath: string; localPath: string };

export interface KnowledgeSourceCollection {
  sources: KnowledgeSource[];
  skipped: KnowledgeIngestSkippedFileResult[];
}

type DownloadResult = { uploadPath: string; localPath: string; bytes?: number };

const knowledgeRunLogger = serverLogger.component("knowledge-ingest");

const getKnowledgeIngestArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    sources: v.array(v.string()).default([]),
    path: v.string().optional(),
    all: v.boolean().default(false),
    recursive: v.boolean().default(false),
    outputDir: v.string().optional(),
    knowledgePath: v.string().default("knowledge"),
    description: v.string().optional(),
    slug: v.string().optional(),
    json: v.boolean().default(false),
    quiet: v.boolean().default(false),
  }).superRefine((value, ctx) => {
    const hasExplicitSources = value.sources.length > 0;
    const hasPath = typeof value.path === "string" && value.path.length > 0;

    if (hasExplicitSources && (hasPath || value.all)) {
      ctx.addIssue({
        code: "custom",
        message: "Use either explicit source paths or --path with --all, not both.",
      });
    }

    if (!hasExplicitSources && !hasPath && !value.all) {
      ctx.addIssue({
        code: "custom",
        message: "Provide one or more source paths or use --path with --all.",
      });
    }

    if (hasPath && !value.all) {
      ctx.addIssue({
        code: "custom",
        message: "--path requires --all.",
      });
    }

    if (!hasPath && value.all) {
      ctx.addIssue({
        code: "custom",
        message: "--all requires --path.",
      });
    }

    if (value.slug && value.sources.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "--slug can only be used with a single explicit source.",
      });
    }
  })
);

const KnowledgeIngestArgsSchema = lazySchema(getKnowledgeIngestArgsSchema);

export type KnowledgeIngestOptions = InferSchema<ReturnType<typeof getKnowledgeIngestArgsSchema>>;

function getBooleanArg(args: ParsedArgs, ...keys: string[]): boolean {
  return keys.some((key) => Boolean(args[key]));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function createKnowledgeIngestEventLogger(): Logger | null {
  const projectId = getEnv("TENANT_PROJECT_ID");
  const runExecutionId = getEnv("RUN_EXECUTION_ID");

  if (!projectId || !runExecutionId) {
    return null;
  }

  return createRunUserLogger(knowledgeRunLogger, {
    projectId,
    runExecutionId: runExecutionId,
    batchId: getEnv("RUN_BATCH_ID") ?? undefined,
    runTarget: getEnv("RUN_TARGET") ?? undefined,
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
): SafeParseResult<KnowledgeIngestOptions> {
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
  }) as SafeParseResult<KnowledgeIngestOptions>;
}

function defaultOutputRoot(): Promise<string> {
  return Deno.makeTempDir({ prefix: "veryfront-knowledge-" });
}

function classifySourceOrSkip(input: {
  source: string;
  localSourcePath?: string | null;
}): KnowledgeIngestSkippedFileResult | null {
  const decision = classifyKnowledgeSourcePath(input.source);
  if (decision.kind === "ingest") {
    return null;
  }

  return {
    source: input.source,
    localSourcePath: input.localSourcePath ?? null,
    message: decision.message,
    reason: decision.reason,
  };
}

export const normalizeKnowledgeInputPath = commandHelpers.normalizeKnowledgeInputPath;
export const normalizeProjectUploadPath = commandHelpers.normalizeProjectUploadPath;
export const formatKnowledgeUploadSource = commandHelpers.formatKnowledgeUploadSource;
export const isLikelyLocalPath = commandHelpers.isLikelyLocalPath;
export const stripChatUploadPrefix = commandHelpers.stripChatUploadPrefix;
export const resolveKnowledgeDownloadOutputDir = commandHelpers.resolveKnowledgeDownloadOutputDir;
export const buildSuggestedSlug = commandHelpers.buildSuggestedSlug;
export const ensureUniqueSlugs = commandHelpers.ensureUniqueSlugs;
export const deriveKnowledgeRemotePath = commandHelpers.deriveKnowledgeRemotePath;
export const createKnowledgeIngestResult = commandHelpers.createKnowledgeIngestResult;
export {
  type KnowledgeParserInput,
  type KnowledgeParserResult,
  runKnowledgeParser,
  runKnowledgeParsers,
} from "./parser.ts";

function resolveExplicitUploadPath(inputPath: string): string {
  return commandHelpers.resolveExplicitUploadPath(inputPath);
}

function isProjectUploadReference(value: string): boolean {
  return commandHelpers.isProjectUploadReference(value);
}

function createFailedKnowledgeSource(input: {
  source: string;
  localSourcePath: string;
  message: string;
  reason: KnowledgeIngestFailedFileResult["reason"];
}): KnowledgeIngestFailedFileResult {
  return commandHelpers.createFailedKnowledgeSource(input);
}

async function collectLocalFiles(
  root: string,
  recursive: boolean,
): Promise<KnowledgeSourceCollection> {
  return commandHelpers.collectLocalFiles(root, recursive);
}

function classifyListedUploadsForKnowledge(uploads: UploadItem[]): {
  skipped: KnowledgeIngestSkippedFileResult[];
  uploadTargets: string[];
} {
  const skipped: KnowledgeIngestSkippedFileResult[] = [];
  const uploadTargets: string[] = [];

  for (const item of uploads) {
    if (item.type === "folder") {
      continue;
    }

    const source = formatKnowledgeUploadSource(item.path);
    const skippedUpload = classifySourceOrSkip({ source });
    if (skippedUpload == null) {
      uploadTargets.push(item.path);
      continue;
    }

    skipped.push(skippedUpload);
  }

  return { skipped, uploadTargets };
}

function buildSourceReference(source: KnowledgeSource): string {
  return commandHelpers.buildSourceReference(source);
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
  let { skipped, uploadTargets } = classifyListedUploadsForKnowledge(uploads);

  if (!uploadTargets.length && uploadPrefix && !uploadPrefix.endsWith("/")) {
    uploads = await listUploadsForPrefix(`${uploadPrefix}/`);
    ({ skipped, uploadTargets } = classifyListedUploadsForKnowledge(uploads));
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
  const recordSourceFailure = (
    source: KnowledgeSource,
    sourceReference: string,
    index: number,
    message: string,
    reason: KnowledgeIngestFailureReason,
  ) => {
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
  };

  for (const [index, source] of sources.entries()) {
    const sourceReference = buildSourceReference(source);

    deps.eventLogger?.info("Processing knowledge source", {
      phase: "file_processing",
      progress_current: index + 1,
      progress_total: sources.length,
      source_name: buildKnowledgeSourceName(source),
    });

    let parser: KnowledgeParserResult;
    try {
      parser = await deps.runParser({
        filePath: source.localPath,
        outputDir: deps.outputDir,
        description: options.description,
        slug: slugs[index],
        sourceReference,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordSourceFailure(source, sourceReference, index, message, "parser_error");
      continue;
    }

    try {
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
      recordSourceFailure(source, sourceReference, index, message, "upload_error");
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
          const runResult = buildKnowledgeIngestRunResult({
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
            ingested_count: runResult.summary.ingested_count,
            skipped_count: runResult.summary.skipped_count,
            failed_count: runResult.summary.failed_count,
          });

          await writeRunResultIfConfigured(runResult);

          if (options.json) {
            printJson(runResult);
            return;
          }

          for (const result of runResult.ingested) {
            if (!options.quiet) {
              cliLogger.info(`Ingested ${result.source} -> ${result.remotePath}`);
              cliLogger.info(`  ${result.summary}`);
            }
          }

          for (const skipped of runResult.skipped) {
            if (!options.quiet) {
              cliLogger.warn(`Skipped ${skipped.source}`);
              cliLogger.warn(`  ${skipped.message}`);
            }
          }

          for (const failure of runResult.failed) {
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
