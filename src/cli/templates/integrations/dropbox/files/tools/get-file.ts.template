import { tool } from "veryfront/tool";
import { z } from "zod";
import { downloadFile, formatFileSize, getMetadata, isFile } from "../../lib/dropbox-client.ts";

export default tool({
  id: "get-file",
  description:
    "Get file metadata and optionally download file content from Dropbox. Use this to read file information or retrieve file contents.",
  inputSchema: z.object({
    path: z.string().describe('Path to the file in Dropbox (e.g., "/Documents/file.txt")'),
    includeContent: z
      .boolean()
      .default(false)
      .describe("Whether to download and return the file content (only works for text files and small files)"),
  }),
  async execute({ path, includeContent }): Promise<Record<string, unknown>> {
    const metadata = await getMetadata(path);

    if (!isFile(metadata)) {
      throw new Error(`Path "${path}" is not a file, it's a ${metadata[".tag"]}`);
    }

    const result: Record<string, unknown> = {
      name: metadata.name,
      path: metadata.path_display ?? metadata.path_lower ?? "",
      id: metadata.id,
      size: metadata.size,
      sizeFormatted: formatFileSize(metadata.size),
      modified: metadata.server_modified,
      clientModified: metadata.client_modified,
      isDownloadable: metadata.is_downloadable,
      rev: metadata.rev,
    };

    if (!includeContent) return result;

    if (!metadata.is_downloadable) {
      throw new Error(`File "${path}" is not downloadable`);
    }

    if (metadata.size > 1024 * 1024) {
      throw new Error(
        `File is too large to download content (${formatFileSize(
          metadata.size,
        )}). Maximum size is 1MB. Use includeContent: false to get metadata only.`,
      );
    }

    try {
      const { content } = await downloadFile(path);
      result.content = content;
      result.contentLength = content.length;
    } catch (error) {
      result.contentError = error instanceof Error ? error.message : "Failed to download content";
    }

    return result;
  },
});
