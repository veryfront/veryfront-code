import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatFileSize, isFile, isFolder, searchFiles } from "../../lib/onedrive-client.ts";

export default tool({
  id: "search-files",
  description:
    "Search for files and folders in OneDrive by name or content. Returns matching items with their paths and metadata.",
  inputSchema: z.object({
    query: z.string().describe("Search query to find files or folders"),
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of results to return"),
  }),
  async execute({ query, maxResults }) {
    const result = await searchFiles(query, { top: maxResults });

    const matches = result.value.map((item) => {
      const baseInfo = {
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
        parentPath: item.parentReference?.path,
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
      matches,
      count: matches.length,
      hasMore: Boolean(result["@odata.nextLink"]),
      query,
    };
  },
});
