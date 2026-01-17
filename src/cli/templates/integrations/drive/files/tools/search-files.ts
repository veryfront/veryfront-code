import { tool } from "veryfront/tool";
import { z } from "zod";
import { createDriveClient } from "../../lib/drive-client.ts";

// Default user ID for demo/dev purposes
// In production, get from authenticated session
const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "search-files",
  description:
    "Search for files and folders in Google Drive using queries. Supports searching by name, content, type, and more. Use Drive query syntax (e.g., \"name contains 'report'\", \"mimeType='application/pdf'\").",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "Search query using Drive query syntax. Examples: \"name contains 'report'\", \"mimeType='application/pdf'\", \"fullText contains 'budget'\"",
      ),
    pageSize: z
      .number()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Maximum number of files to return"),
    pageToken: z
      .string()
      .optional()
      .describe("Token for pagination to get next page of results"),
    orderBy: z
      .enum([
        "createdTime",
        "folder",
        "modifiedByMeTime",
        "modifiedTime",
        "name",
        "quotaBytesUsed",
        "recency",
        "sharedWithMeTime",
        "starred",
        "viewedByMeTime",
      ])
      .optional()
      .describe("Field to sort results by"),
  }),
  async execute({ query, pageSize, pageToken, orderBy }) {
    const client = createDriveClient(DEFAULT_USER_ID);

    const orderByParam = orderBy ? `${orderBy} desc` : undefined;

    const result = await client.searchFiles({
      query,
      pageSize,
      pageToken,
      orderBy: orderByParam,
    });

    return {
      files: result.files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        isFolder:
          file.mimeType === "application/vnd.google-apps.folder",
        size: file.size,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        webViewLink: file.webViewLink,
        iconLink: file.iconLink,
        thumbnailLink: file.thumbnailLink,
        starred: file.starred,
        shared: file.shared,
        parents: file.parents,
      })),
      nextPageToken: result.nextPageToken,
      hasMore: !!result.nextPageToken,
      incompleteSearch: result.incompleteSearch,
    };
  },
});
