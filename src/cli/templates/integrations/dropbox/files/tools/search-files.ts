import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatFileSize, isFile, searchFiles } from "../../lib/dropbox-client.ts";

export default tool({
  id: "search-files",
  description:
    "Search for files and folders in Dropbox by name or content. Returns matching items with their paths and metadata.",
  inputSchema: z.object({
    query: z.string().describe("Search query to find files or folders"),
    path: z.string().optional().describe("Optional path to limit search to a specific folder"),
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of results to return"),
    fileCategories: z
      .array(
        z.enum([
          "image",
          "document",
          "pdf",
          "spreadsheet",
          "presentation",
          "audio",
          "video",
          "folder",
          "paper",
          "others",
        ]),
      )
      .optional()
      .describe("Filter by file categories"),
  }),
  async execute({ query, path, maxResults, fileCategories }) {
    const result = await searchFiles(query, { path, maxResults, fileCategories });

    const matches = result.matches.map((match) => {
      const metadata = match.metadata.metadata;
      const baseInfo = {
        name: metadata.name,
        path: metadata.path_display ?? metadata.path_lower ?? "",
        id: metadata.id,
        type: metadata[".tag"],
        matchType: match.match_type[".tag"],
      };

      if (!isFile(metadata)) return baseInfo;

      return {
        ...baseInfo,
        size: metadata.size,
        sizeFormatted: formatFileSize(metadata.size),
        modified: metadata.server_modified,
        clientModified: metadata.client_modified,
        isDownloadable: metadata.is_downloadable,
      };
    });

    return {
      matches,
      count: matches.length,
      hasMore: result.has_more,
      query,
    };
  },
});
