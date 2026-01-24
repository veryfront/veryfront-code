import { tool } from "veryfront/tool";
import { z } from "zod";
import { createFolder, uploadFile } from "../../lib/sharepoint-client.ts";

export default tool({
  id: "upload-file",
  description:
    "Upload a file to a SharePoint document library. Can upload to root or a specific folder.",
  inputSchema: z.object({
    siteId: z.string().describe("The ID of the SharePoint site"),
    driveId: z.string().describe("The ID of the document library (drive) to upload to"),
    fileName: z.string().describe("The name of the file to create (including extension)"),
    content: z.string().describe("The content of the file to upload"),
    folderId: z
      .string()
      .optional()
      .describe("Optional folder ID to upload into. If not provided, uploads to root."),
    createFolderIfNeeded: z
      .boolean()
      .default(false)
      .describe("If true and folderPath is provided, creates the folder if it does not exist"),
    folderPath: z
      .string()
      .optional()
      .describe(
        'Optional folder path (e.g., "Documents/Projects") to create if createFolderIfNeeded is true',
      ),
  }),
  async execute({
    siteId,
    driveId,
    fileName,
    content,
    folderId,
    createFolderIfNeeded,
    folderPath,
  }) {
    let targetFolderId = folderId;

    if (createFolderIfNeeded && folderPath && !folderId) {
      const folders = folderPath.split("/").filter(Boolean);
      let currentFolderId: string | undefined;

      for (const folderName of folders) {
        try {
          const folder = await createFolder(siteId, driveId, folderName, currentFolderId);
          currentFolderId = folder.id;
        } catch (error) {
          console.warn(`Note: Could not create folder "${folderName}":`, error);
        }
      }

      targetFolderId = currentFolderId;
    }

    const file = await uploadFile(siteId, driveId, fileName, content, targetFolderId);

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}
