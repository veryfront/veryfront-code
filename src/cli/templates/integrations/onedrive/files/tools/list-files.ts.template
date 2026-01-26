import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatFileSize, isFile, isFolder, listFiles } from "../../lib/onedrive-client.ts";

export default tool({
  id: "list-files",
  description:
    "List files and folders in a OneDrive folder. Returns file/folder names, types, sizes, and modification dates.",
  inputSchema: z.object({
    folderId: z
      .string()
      .default("root")
      .describe('Folder ID or "root" for the root folder'),
    orderBy: z
      .string()
      .optional()
      .describe('Order by field (e.g., "name", "lastModifiedDateTime desc")'),
    limit: z
      .number()
      .min(1)
      .max(200)
      .default(100)
      .describe("Maximum number of items to return"),
  }),
  async execute({ folderId, orderBy, limit }) {
    const result = await listFiles(folderId, { orderBy, top: limit });

    const items = result.value.map((item) => {
      const baseInfo = {
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
      };

      if (isFile(item)) {
        const size = item.size ?? 0;

        return {
          ...baseInfo,
          type: "file" as const,
          size,
          sizeFormatted: formatFileSize(size),
          mimeType: item.file?.mimeType,
        };
      }

      if (isFolder(item)) {
        return {
          ...baseInfo,
          type: "folder" as const,
          childCount: item.folder?.childCount ?? 0,
        };
      }

      return {
        ...baseInfo,
        type: "unknown" as const,
      };
    });

    return {
      items,
      count: items.length,
      hasMore: Boolean(result["@odata.nextLink"]),
    };
  },
});
