import { tool } from "veryfront/tool";
import { z } from "zod";
import { listFiles, searchFiles } from "../../lib/sharepoint-client.ts";

export default tool({
  id: "list-files",
  description:
    "List files and folders in a SharePoint document library. Can list root level or a specific folder, or search across the entire library.",
  inputSchema: z.object({
    siteId: z.string().describe("The ID of the SharePoint site"),
    driveId: z.string().describe("The ID of the document library (drive)"),
    folderId: z
      .string()
      .optional()
      .describe(
        "Optional folder ID to list contents from. If not provided, lists root level.",
      ),
    search: z
      .string()
      .optional()
      .describe(
        "Optional search query to find files by name or content instead of listing",
      ),
    orderBy: z
      .enum(["name", "lastModifiedDateTime", "size"])
      .optional()
      .describe("Sort order for results"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of items to return"),
  }),
  async execute({ siteId, driveId, folderId, search, orderBy, limit }) {
    const files = search
      ? await searchFiles(siteId, search, { limit })
      : await listFiles(siteId, driveId, folderId, { limit, orderBy });

    return files.map((file) => ({
      id: file.id,
      name: file.name,
      type: file.folder ? "folder" : "file",
      size: file.size,
      sizeFormatted: formatBytes(file.size),
      mimeType: file.file?.mimeType,
      url: file.webUrl,
      created: file.createdDateTime,
      lastModified: file.lastModifiedDateTime,
      createdBy: file.createdBy?.user?.displayName,
      lastModifiedBy: file.lastModifiedBy?.user?.displayName,
      parentPath: file.parentReference?.path,
      childCount: file.folder?.childCount,
    }));
  },
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}
