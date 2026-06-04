import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { downloadFileAsText, getFile } from "../../lib/sharepoint-client.ts";

export default tool({
  id: "get-file",
  description:
    "Get detailed metadata and optionally download content of a file from SharePoint. Can retrieve text content for text-based files.",
  inputSchema: defineSchema((v) => v.object({
    siteId: v.string().describe("The ID of the SharePoint site"),
    driveId: v.string().describe("The ID of the document library (drive)"),
    itemId: v.string().describe("The ID of the file to retrieve"),
    includeContent: v
      .boolean()
      .default(false)
      .describe(
        "Whether to download and include the file content (only works for text-based files)",
      ),
  }))(),
  async execute({ siteId, driveId, itemId, includeContent }) {
    const file = await getFile(siteId, driveId, itemId);

    const result: Record<string, unknown> = {
      id: file.id,
      name: file.name,
      size: file.size,
      sizeFormatted: formatBytes(file.size),
      mimeType: file.file?.mimeType,
      url: file.webUrl,
      created: file.createdDateTime,
      lastModified: file.lastModifiedDateTime,
      createdBy: {
        name: file.createdBy?.user?.displayName,
        email: file.createdBy?.user?.email,
      },
      lastModifiedBy: {
        name: file.lastModifiedBy?.user?.displayName,
        email: file.lastModifiedBy?.user?.email,
      },
      parentReference: {
        driveId: file.parentReference?.driveId,
        id: file.parentReference?.id,
        path: file.parentReference?.path,
      },
      hashes: file.file?.hashes,
    };

    if (!includeContent) return result;

    const mimeType = file.file?.mimeType;
    if (!mimeType) return result;

    const isTextFile = [
      "text/",
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
    ].some((type) => mimeType.startsWith(type));

    if (!isTextFile) {
      result.contentError = "File is not a text-based file type";
      return result;
    }

    try {
      const content = await downloadFileAsText(siteId, driveId, itemId);
      result.content = content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.contentError = `Failed to download content: ${message}`;
    }

    return result;
  },
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}
