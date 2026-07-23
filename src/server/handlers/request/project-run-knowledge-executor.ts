import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { Logger } from "#veryfront/utils";
import { projectRunErrorMessage } from "./project-run-http-policy.ts";
import { getProjectRunStringArrayConfig, getProjectRunStringConfig } from "./project-run-config.ts";
import {
  createProjectRunRuntimeApiClient,
  resolveProjectRunUploadIdsToPaths,
} from "./project-run-runtime-api.ts";
import type { ProjectRunExecuteResponse, ProjectRunExecutorInput } from "./project-run-types.ts";

function createKnowledgeEventLogger(lines: string[]): Logger {
  const append = (level: string, message: string, metadata?: unknown) => {
    const fields = metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {};
    lines.push(JSON.stringify({ level, message, ...fields }));
  };
  const logger: Logger = {
    info: (message, metadata) => append("info", message, metadata),
    warn: (message, metadata) => append("warn", message, metadata),
    error: (message, metadata) => append("error", message, metadata),
    debug: (message, metadata) => append("debug", message, metadata),
    async time<T>(_label: string, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    child: () => logger,
    component: () => logger,
  };
  return logger;
}

export async function executeKnowledgeIngestRun(
  input: ProjectRunExecutorInput,
): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const client = createProjectRunRuntimeApiClient(input.req, input.ctx);
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  const outputDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-run-" });
  const logLines: string[] = [];

  try {
    const { buildKnowledgeIngestRunResult } = await import("#cli/commands/knowledge/result");
    const {
      collectKnowledgeSources,
      ingestResolvedSources,
      resolveKnowledgeDownloadOutputDir,
      runKnowledgeParser,
    } = await import("#cli/commands/knowledge/command");
    const { downloadUploadToFile } = await import("#cli/commands/uploads/command");
    const { putRemoteFileFromLocal } = await import("#cli/commands/files/command");

    const uploadIds = getProjectRunStringArrayConfig(config, ["upload_ids", "uploadIds"]);
    const paths = getProjectRunStringArrayConfig(config, [
      "paths",
      "upload_paths",
      "uploadPaths",
    ]);
    const uploadPaths = [
      ...paths,
      ...await resolveProjectRunUploadIdsToPaths(client, projectReference, uploadIds),
    ];
    const pathPrefix = getProjectRunStringConfig(config, [
      "path_prefix",
      "upload_prefix",
      "pathPrefix",
      "uploadPrefix",
    ]);
    const knowledgePath = getProjectRunStringConfig(config, ["knowledge_path", "knowledgePath"]) ??
      "knowledge";
    const description = getProjectRunStringConfig(config, ["description"]);
    const recursive = config.recursive === undefined ? true : Boolean(config.recursive);

    if (uploadPaths.length > 0 && pathPrefix) {
      throw INVALID_ARGUMENT.create({ detail: "Use upload paths or upload prefix, not both." });
    }

    const options = {
      projectSlug: projectReference,
      projectDir: input.ctx.projectDir,
      sources: uploadPaths,
      path: pathPrefix,
      all: pathPrefix !== undefined,
      recursive,
      outputDir,
      knowledgePath,
      description,
      slug: getProjectRunStringConfig(config, ["slug"]),
      json: true,
      quiet: true,
    };
    const downloadOutputDir = resolveKnowledgeDownloadOutputDir(outputDir);
    const sourceMode = pathPrefix ? "path_prefix" : "explicit_sources";
    const collection = await collectKnowledgeSources(options, {
      client,
      projectSlug: projectReference,
      downloadUploads: (uploadTargets) =>
        Promise.all(
          uploadTargets.map((uploadPath) =>
            downloadUploadToFile(client, projectReference, uploadPath, downloadOutputDir)
          ),
        ),
    });
    const requestedCount = collection.sources.length + collection.skipped.length;
    if (requestedCount === 0) {
      throw INVALID_ARGUMENT.create({ detail: "No supported knowledge sources were found." });
    }

    const results = await ingestResolvedSources(collection.sources, options, {
      client,
      projectSlug: projectReference,
      outputDir,
      runParser: runKnowledgeParser,
      eventLogger: createKnowledgeEventLogger(logLines),
      uploadKnowledgeFile: (remotePath, localPath) =>
        putRemoteFileFromLocal(client, projectReference, remotePath, localPath),
    });
    const result = buildKnowledgeIngestRunResult({
      requestedCount,
      sourceMode,
      knowledgePath,
      ingested: results.ingested,
      skipped: collection.skipped,
      failed: results.failed,
    });
    const failedCount = result.summary.failed_count;
    const ingestedCount = result.summary.ingested_count;

    return {
      success: failedCount === 0 && ingestedCount > 0,
      result,
      error: failedCount > 0
        ? `${failedCount} knowledge source${failedCount === 1 ? "" : "s"} failed`
        : ingestedCount === 0
        ? "No knowledge sources were ingested"
        : null,
      logs: logLines.length > 0 ? logLines.join("\n") : null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      error: projectRunErrorMessage(error),
      logs: logLines.length > 0 ? logLines.join("\n") : null,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await Deno.remove(outputDir, { recursive: true }).catch(() => undefined);
  }
}
