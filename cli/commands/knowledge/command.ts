import { z } from "zod";
import { createFileSystem } from "veryfront/platform";
import { basename, extname, join, normalize, relative } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import { cliLogger } from "#cli/utils";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { downloadUploadToFile, listAllUploads, type UploadItem } from "../uploads/command.ts";
import { putRemoteFileFromLocal } from "../files/command.ts";
import { knowledgeIngestPythonSource } from "./parser-source.ts";

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".csv",
  ".tsv",
  ".docx",
  ".xlsx",
  ".xls",
  ".pptx",
  ".html",
  ".htm",
  ".txt",
  ".json",
  ".md",
  ".mdx",
]);

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

export interface KnowledgeIngestFileResult {
  source: string;
  localSourcePath: string;
  outputPath: string;
  remotePath: string;
  slug: string;
  sourceType: string;
  summary: string;
  stats: Record<string, unknown>;
  warnings: string[];
}

type KnowledgeSource =
  | { kind: "local"; input: string; localPath: string }
  | { kind: "upload"; input: string; uploadPath: string; localPath: string };

type DownloadResult = { uploadPath: string; localPath: string; bytes?: number };

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

export function isLikelyLocalPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(value);
}

function isProjectUploadReference(value: string): boolean {
  if (isLikelyLocalPath(value)) return false;
  const normalizedValue = normalize(value).replace(/\\/g, "/").replace(/^\/+/, "");
  return normalizedValue === "uploads" || normalizedValue.startsWith("uploads/");
}

function isSupportedKnowledgeFile(path: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase());
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

async function collectLocalFiles(root: string, recursive: boolean): Promise<string[]> {
  const fs = createFileSystem();
  const stat = await fs.stat(root);
  if (stat.isFile) return isSupportedKnowledgeFile(root) ? [root] : [];
  if (!stat.isDirectory) return [];

  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for await (const entry of fs.readDir(dir)) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory) {
        if (recursive) await walk(entryPath);
        continue;
      }
      if (entry.isFile && isSupportedKnowledgeFile(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  await walk(root);
  return files.sort();
}

function buildSourceReference(source: KnowledgeSource): string {
  return source.kind === "upload" ? formatKnowledgeUploadSource(source.uploadPath) : source.input;
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
          "knowledge ingest requires python3. Install python3 and the supported parser packages, or run the command inside the Veryfront sandbox.",
        );
      }
      throw error;
    }

    if (result.code !== 0) {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      throw new Error(`knowledge ingest parser failed${stderr ? `: ${stderr}` : ""}`);
    }

    const raw = await Deno.readTextFile(outputJsonPath);
    return JSON.parse(raw) as KnowledgeParserResult;
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
): Promise<KnowledgeSource[]> {
  const fs = createFileSystem();

  if (options.sources.length > 0) {
    const explicitSources: Array<
      | { kind: "local"; sources: KnowledgeSource[] }
      | { kind: "upload"; input: string; uploadPath: string }
    > = [];
    const uploadTargets: string[] = [];

    for (const input of options.sources) {
      if (!isProjectUploadReference(input) && await fs.exists(input)) {
        const localFiles = await collectLocalFiles(input, options.recursive);
        if (!localFiles.length) throw new Error(`No supported files found at ${input}`);
        explicitSources.push({
          kind: "local",
          sources: localFiles.map((localPath) => ({ kind: "local", input, localPath })),
        });
        continue;
      }

      if (isLikelyLocalPath(input)) {
        throw new Error(`Local file not found: ${input}`);
      }

      const uploadPath = normalizeProjectUploadPath(input);
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
        resolvedSources.push(...source.sources);
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

    return resolvedSources;
  }

  if (!options.path || !options.all) {
    throw new Error("Provide one or more source paths or use --path with --all.");
  }

  if (!isProjectUploadReference(options.path) && await fs.exists(options.path)) {
    const localFiles = await collectLocalFiles(options.path, options.recursive);
    if (!localFiles.length) throw new Error(`No supported files found under ${options.path}`);
    return localFiles.map((localPath) => ({ kind: "local", input: options.path!, localPath }));
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
  let uploadTargets = uploads
    .filter((item: UploadItem) => item.type !== "folder" && isSupportedKnowledgeFile(item.path))
    .map((item: UploadItem) => item.path);

  if (!uploadTargets.length && uploadPrefix && !uploadPrefix.endsWith("/")) {
    uploads = await listUploadsForPrefix(`${uploadPrefix}/`);
    uploadTargets = uploads
      .filter((item: UploadItem) => item.type !== "folder" && isSupportedKnowledgeFile(item.path))
      .map((item: UploadItem) => item.path);
  }

  if (!uploadTargets.length) {
    throw new Error(`No supported uploads found under ${displayUploadPrefix}`);
  }

  const downloads = await deps.downloadUploads(uploadTargets);
  return downloads.map((download) => ({
    kind: "upload",
    input: options.path!,
    uploadPath: download.uploadPath,
    localPath: download.localPath,
  }));
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
  },
): Promise<KnowledgeIngestFileResult[]> {
  if (options.slug && sources.length !== 1) {
    throw new Error("--slug can only be used with a single explicit source.");
  }

  const slugs = options.slug ? [options.slug] : ensureUniqueSlugs(sources);
  const results: KnowledgeIngestFileResult[] = [];

  for (const [index, source] of sources.entries()) {
    const parser = await deps.runParser({
      filePath: source.localPath,
      outputDir: deps.outputDir,
      description: options.description,
      slug: slugs[index],
      sourceReference: buildSourceReference(source),
    });
    const remotePath = deriveKnowledgeRemotePath(
      parser.sandbox_output_path,
      deps.outputDir,
      options.knowledgePath,
    );
    const uploaded = await deps.uploadKnowledgeFile(remotePath, parser.sandbox_output_path);
    results.push(
      createKnowledgeIngestResult({
        source: buildSourceReference(source),
        localSourcePath: source.localPath,
        outputPath: parser.sandbox_output_path,
        remotePath: uploaded.path,
        parser,
      }),
    );
  }

  return results;
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

        try {
          const sources = await collectKnowledgeSources(options, {
            client,
            projectSlug: config.projectSlug,
            downloadUploads: (uploadPaths) =>
              Promise.all(
                uploadPaths.map((uploadPath) =>
                  downloadUploadToFile(client, config.projectSlug, uploadPath, downloadOutputDir)
                ),
              ),
          });

          const results = await ingestResolvedSources(sources, options, {
            client,
            projectSlug: config.projectSlug,
            outputDir,
            runParser: runKnowledgeParser,
            uploadKnowledgeFile: (remotePath, localPath) =>
              putRemoteFileFromLocal(client, config.projectSlug, remotePath, localPath),
          });

          if (options.json) {
            printJson(results);
            return;
          }

          for (const result of results) {
            if (!options.quiet) {
              cliLogger.info(`Ingested ${result.source} -> ${result.remotePath}`);
              cliLogger.info(`  ${result.summary}`);
            }
          }
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
