import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOneDriveClient } from "../lib/onedrive-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "onedrive-search-files",
  description:
    "Search for files and folders in OneDrive by name or content. Returns matching items with their paths and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      query: v.string().describe("Search query to find files or folders"),
      maxResults: v
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of results to return"),
    })
  )(),
  async execute({ query, maxResults }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOneDriveClient(userId);
    const result = await client.searchFiles(query, { top: maxResults });

    const matches = result.value.map((item) => {
      const baseInfo = {
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
        parentPath: item.parentReference?.path,
      };

      if (client.isFile(item)) {
        const size = item.size ?? 0;

        return {
          ...baseInfo,
          type: "file" as const,
          size,
          sizeFormatted: client.formatFileSize(size),
          mimeType: item.file?.mimeType,
        };
      }

      if (client.isFolder(item)) {
        return {
          ...baseInfo,
          type: "folder" as const,
          childCount: item.folder?.childCount ?? 0,
        };
      }

      return { ...baseInfo, type: "unknown" as const };
    });

    return {
      matches,
      count: matches.length,
      hasMore: Boolean(result["@odata.nextLink"]),
      query,
    };
  },
});
