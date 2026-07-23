import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSharePointClient } from "../lib/sharepoint-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "upload-file",
  description:
    "Upload a file to a SharePoint document library. Can upload to root or a specific folder.",
  inputSchema: defineSchema((v) =>
    v.object({
      siteId: v.string().describe("The ID of the SharePoint site"),
      driveId: v.string().describe(
        "The ID of the document library (drive) to upload to",
      ),
      fileName: v.string().describe(
        "The name of the file to create (including extension)",
      ),
      content: v.string().describe("The content of the file to upload"),
      folderId: v
        .string()
        .optional()
        .describe(
          "Optional folder ID to upload into. If not provided, uploads to root.",
        ),
      createFolderIfNeeded: v
        .boolean()
        .default(false)
        .describe(
          "If true and folderPath is provided, creates the folder if it does not exist",
        ),
      folderPath: v
        .string()
        .optional()
        .describe(
          'Optional folder path (e.g., "Documents/Projects") to create if createFolderIfNeeded is true',
        ),
    })
  )(),
  async execute({
    siteId,
    driveId,
    fileName,
    content,
    folderId,
    createFolderIfNeeded,
    folderPath,
  }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createSharePointClient(userId);
    const targetFolderId = await resolveTargetFolderId({
      createFolder: client.createFolder,
      siteId,
      driveId,
      folderId,
      createFolderIfNeeded,
      folderPath,
    });

    const file = await client.uploadFile(
      siteId,
      driveId,
      fileName,
      content,
      targetFolderId,
    );

    return {
      id: file.id,
      name: file.name,
      size: file.size,
      sizeFormatted: formatBytes(file.size),
      mimeType: file.file?.mimeType,
      url: file.webUrl,
      created: file.createdDateTime,
      lastModified: file.lastModifiedDateTime,
      parentPath: file.parentReference?.path,
      message: `Successfully uploaded "${fileName}" to SharePoint`,
    };
  },
});

async function resolveTargetFolderId({
  createFolder,
  siteId,
  driveId,
  folderId,
  createFolderIfNeeded,
  folderPath,
}: {
  createFolder: (
    siteId: string,
    driveId: string,
    folderName: string,
    parentFolderId?: string,
  ) => Promise<{ id: string }>;
  siteId: string;
  driveId: string;
  folderId?: string;
  createFolderIfNeeded: boolean;
  folderPath?: string;
}): Promise<string | undefined> {
  if (!createFolderIfNeeded || !folderPath || folderId) return folderId;

  const folders = folderPath.split("/").filter(Boolean);
  let currentFolderId: string | undefined;

  for (const folderName of folders) {
    try {
      const folder = await createFolder(
        siteId,
        driveId,
        folderName,
        currentFolderId,
      );
      currentFolderId = folder.id;
    } catch (error) {
      console.warn(`Note: Could not create folder "${folderName}":`, error);
    }
  }

  return currentFolderId;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}
