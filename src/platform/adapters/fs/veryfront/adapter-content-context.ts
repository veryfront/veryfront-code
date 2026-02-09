import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.ts";
import type { ContentSource, ResolvedContentContext } from "./types.ts";

type ContextResolverClient = Pick<
  VeryfrontAPIClient,
  "listEnvironmentFiles" | "lookupProjectByDomain"
>;

type FileListClient = Pick<
  VeryfrontAPIClient,
  "listAllEnvironmentFiles" | "listAllFiles" | "listPublishedFiles"
>;

type ClientContextInput = Parameters<VeryfrontAPIClient["setContext"]>[0];

export function isSourceFile(path: string): boolean {
  return (
    path.endsWith(".tsx") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mdx") ||
    path.endsWith(".ts") ||
    path.endsWith(".js")
  );
}

export function summarizeFileList(files: Array<{ path: string; content?: string }>): {
  totalFiles: number;
  filesWithContent: number;
  sourceFiles: number;
  sourceFilesWithContent: number;
} {
  let filesWithContent = 0;
  let sourceFiles = 0;
  let sourceFilesWithContent = 0;

  for (const file of files) {
    const hasContent = !!file.content;
    if (hasContent) {
      filesWithContent++;
    }

    if (isSourceFile(file.path)) {
      sourceFiles++;
      if (hasContent) {
        sourceFilesWithContent++;
      }
    }
  }

  return {
    totalFiles: files.length,
    filesWithContent,
    sourceFiles,
    sourceFilesWithContent,
  };
}

export function hasContentContextChanged(
  previous: ResolvedContentContext | null,
  next: ResolvedContentContext,
): boolean {
  return !previous ||
    previous.sourceType !== next.sourceType ||
    previous.projectSlug !== next.projectSlug ||
    previous.branch !== next.branch ||
    previous.environmentName !== next.environmentName ||
    previous.releaseId !== next.releaseId;
}

export function toClientContext(context: ResolvedContentContext): ClientContextInput {
  switch (context.sourceType) {
    case "branch":
      return { type: "branch", name: context.branch ?? "main" };
    case "environment":
      return {
        type: "environment",
        name: context.environmentName ?? "production",
      };
    case "release":
      return { type: "release", version: context.releaseId ?? "" };
  }
}

export async function resolveContentContext(
  client: ContextResolverClient,
  contentSource: ContentSource,
  projectSlug: string,
): Promise<ResolvedContentContext> {
  switch (contentSource.type) {
    case "branch":
      return {
        sourceType: "branch",
        projectSlug,
        branch: contentSource.branch ?? "main",
      };

    case "environment": {
      const envResult = await client.listEnvironmentFiles(contentSource.name);
      return {
        sourceType: "environment",
        projectSlug,
        environmentName: contentSource.name,
        releaseId: envResult.release_id,
      };
    }

    case "domain": {
      const lookup = await client.lookupProjectByDomain(contentSource.domain);
      if (!lookup) {
        throw new Error(`Domain lookup failed for: ${contentSource.domain}`);
      }
      return {
        sourceType: "environment",
        projectSlug: lookup.project_slug,
        environmentName: lookup.environment?.name ?? "production",
        releaseId: lookup.release_id ?? undefined,
      };
    }

    case "release":
      if (!contentSource.releaseId) {
        throw new Error(
          `Missing releaseId for release sourceType (project: ${projectSlug})`,
        );
      }
      return {
        sourceType: "release",
        projectSlug,
        releaseId: contentSource.releaseId,
      };
  }
}

export function fetchFileListForContext(
  client: FileListClient,
  context: ResolvedContentContext,
): Promise<Array<{ path: string; content?: string }>> {
  switch (context.sourceType) {
    case "branch":
      return client.listAllFiles();
    case "environment":
      return client.listAllEnvironmentFiles(context.environmentName!);
    case "release":
      return client.listPublishedFiles(undefined, context.releaseId);
  }
}
