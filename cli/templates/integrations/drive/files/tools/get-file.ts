import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDriveClient } from "../lib/drive-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export default tool({
  id: "get-file",
  description:
    "Get detailed metadata about a specific file or folder in Google Drive. Returns detailed information including sharing settings, owners, and capabilities.",
  inputSchema: defineSchema((v) =>
    v.object({
      fileId: v.string().describe("The ID of the file or folder to retrieve"),
    })
  )(),
  async execute({ fileId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDriveClient(userId);
    const file = await client.getFile(fileId);

    const lastModifyingUser = file.lastModifyingUser
      ? {
        name: file.lastModifyingUser.displayName,
        email: file.lastModifyingUser.emailAddress,
        photoLink: file.lastModifyingUser.photoLink,
      }
      : undefined;

    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      isFolder: file.mimeType === FOLDER_MIME_TYPE,
      size: file.size,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      webContentLink: file.webContentLink,
      iconLink: file.iconLink,
      thumbnailLink: file.thumbnailLink,
      parents: file.parents,
      starred: file.starred,
      trashed: file.trashed,
      shared: file.shared,
      owners: file.owners?.map((owner) => ({
        name: owner.displayName,
        email: owner.emailAddress,
        photoLink: owner.photoLink,
      })),
      lastModifyingUser,
      capabilities: file.capabilities,
    };
  },
});
