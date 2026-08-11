import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDriveClient } from "../lib/drive-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export default tool({
  id: "drive-list-files",
  description:
    "List files and folders in Google Drive. Can list from a specific folder or root. Returns file names, IDs, types, and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      folderId: v
        .string()
        .optional()
        .describe(
          "ID of the folder to list files from. If not provided, lists from root.",
        ),
      pageSize: v
        .number()
        .min(1)
        .max(1000)
        .default(100)
        .describe("Maximum number of files to return"),
      pageToken: v
        .string()
        .optional()
        .describe("Token for pagination to get next page of results"),
      orderBy: v
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
    })
  )(),
  async execute({ folderId, pageSize, pageToken, orderBy }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDriveClient(userId);

    const result = await client.listFiles({
      folderId,
      pageSize,
      pageToken,
      orderBy: orderBy ? `${orderBy} desc` : undefined,
    });

    const nextPageToken = result.nextPageToken;

    return {
      files: result.files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        isFolder: file.mimeType === FOLDER_MIME_TYPE,
        size: file.size,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        webViewLink: file.webViewLink,
        iconLink: file.iconLink,
        thumbnailLink: file.thumbnailLink,
        starred: file.starred,
        shared: file.shared,
      })),
      nextPageToken,
      hasMore: Boolean(nextPageToken),
    };
  },
});
