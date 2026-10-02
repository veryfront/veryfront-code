import { API_CLIENT_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import { logger as baseLogger } from "#veryfront/utils";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import {
  admitVerifiedSourceContents,
  assembleSourceListing,
  forgetVerifiedSource,
  hasVerifiedSourceContents,
} from "./source-content-store.ts";
import type { ContentSource, ResolvedContentContext } from "./types.ts";

const logger = baseLogger.component("veryfront-fs-adapter");

type ContextResolverClient = Pick<
  VeryfrontApiClient,
  "listEnvironmentFiles" | "lookupProjectByDomain"
>;

type FileListClient = Pick<
  VeryfrontApiClient,
  "listAllEnvironmentFiles" | "listAllFiles" | "listPublishedFiles"
>;

type ClientContextInput = Parameters<VeryfrontApiClient["setContext"]>[0];

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
      if (context.releaseId) {
        return { type: "release", version: context.releaseId };
      }
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
        throw API_CLIENT_ERROR.create({
          detail: `Domain lookup failed for: ${contentSource.domain}`,
        });
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
        throw INVALID_ARGUMENT.create({
          detail: `Missing releaseId for release sourceType (project: ${projectSlug})`,
        });
      }
      return {
        sourceType: "release",
        projectSlug,
        releaseId: contentSource.releaseId,
      };
  }
}

/** Every listing field except `content`, which verified contents supply. */
const SOURCE_METADATA_FIELDS = [
  "id",
  "version_id",
  "path",
  "size",
  "type",
  "updated_at",
  "checksum",
] as const;

/**
 * List a source for the current credential. A branch whose contents this
 * process already verified is listed as metadata only: the credential's own
 * listing still decides which files exist, at which versions, and which it may
 * see, and verified contents are attached by checksum. Any file without a
 * verified content falls back to the complete listing, whose contents are
 * then verified for later credentials.
 */
export async function fetchSourceListingForContext(
  client: FileListClient,
  context: ResolvedContentContext,
  sourceKey: string,
): Promise<{ files: Array<{ path: string; content?: string }>; contentReused: boolean }> {
  if (context.sourceType !== "branch") {
    return { files: await fetchFileListForContext(client, context), contentReused: false };
  }

  const branch = { type: "branch", name: context.branch ?? "main" } as const;
  if (hasVerifiedSourceContents(sourceKey)) {
    let metadata: Awaited<ReturnType<FileListClient["listAllFiles"]>> | undefined;
    try {
      metadata = await client.listAllFiles({ fields: SOURCE_METADATA_FIELDS }, branch);
    } catch (error) {
      // The complete listing below reports any failure that is not specific
      // to the metadata query, so this one only stops further attempts.
      forgetVerifiedSource(sourceKey);
      logger.debug("Metadata listing failed; listing contents", {
        projectSlug: context.projectSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const assembled = metadata && assembleSourceListing(sourceKey, metadata);
    if (assembled) return { files: assembled, contentReused: true };
  }

  const files = await client.listAllFiles({}, branch);
  await admitVerifiedSourceContents(sourceKey, files);
  return { files, contentReused: false };
}

export function fetchFileListForContext(
  client: FileListClient,
  context: ResolvedContentContext,
): Promise<Array<{ path: string; content?: string }>> {
  switch (context.sourceType) {
    case "branch":
      return client.listAllFiles({}, { type: "branch", name: context.branch ?? "main" });
    case "environment":
      return context.releaseId
        ? client.listPublishedFiles(undefined, context.releaseId)
        : client.listAllEnvironmentFiles(context.environmentName!);
    case "release":
      return client.listPublishedFiles(undefined, context.releaseId);
  }
}
