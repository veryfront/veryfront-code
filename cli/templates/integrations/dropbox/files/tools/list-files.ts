import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatFileSize, isFile, listFolder } from "../../lib/dropbox-client.ts";

export default tool({
  id: "list-files",
  description:
    "List files and folders in a Dropbox folder. Returns file/folder names, types, sizes, and modification dates.",
  inputSchema: z.object({
    path: z
      .string()
      .default("")
      .describe(
        'Path to the folder to list (empty string for root, or "/FolderName" for specific folder)',
      ),
    recursive: z.boolean().default(false).describe("Whether to list files recursively in subfolders"),
    limit: z.number().min(1).max(500).default(100).describe("Maximum number of items to return"),
  }),
  async execute({ path, recursive, limit }) {
    const result = await listFolder(path, { recursive, limit });

    const items = result.entries.map((entry) => {
      const baseInfo = {
        name: entry.name,
        path: entry.path_display ?? entry.path_lower ?? "",
        id: entry.id,
        type: entry[".tag"],
      };

      if (!isFile(entry)) {
        return baseInfo;
      }

      return {
        ...baseInfo,
        size: entry.size,
        sizeFormatted: formatFileSize(entry.size),
        modified: entry.server_modified,
        clientModified: entry.client_modified,
        isDownloadable: entry.is_downloadable,
        rev: entry.rev,
      };
    });

    return {
      items,
      count: items.length,
      hasMore: result.has_more,
      cursor: result.cursor,
    };
  },
});
