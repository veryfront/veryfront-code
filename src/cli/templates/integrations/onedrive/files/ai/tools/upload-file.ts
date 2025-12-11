import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatFileSize, uploadFile } from "../../lib/onedrive-client.ts";

export default tool({
  id: "upload-file",
  description:
    "Upload or update a file in OneDrive. Can create new files or overwrite existing ones.",
  inputSchema: z.object({
    fileName: z.string().describe(
      "Name of the file to upload (e.g., 'notes.txt', 'document.pdf')",
    ),
    content: z.string().describe("The content to write to the file"),
    parentFolderId: z.string().default("root").describe(
      'Parent folder ID where the file should be uploaded (default: "root")',
    ),
  }),
  async execute({ fileName, content, parentFolderId }) {
    if (!fileName || fileName.trim().length === 0) {
      throw new Error("Filename cannot be empty");
    }

    if (fileName.includes("/") || fileName.includes("\\")) {
      throw new Error("Filename cannot contain path separators");
    }

    const result = await uploadFile(fileName, content, parentFolderId);

    return {
      success: true,
      id: result.id,
      name: result.name,
      webUrl: result.webUrl,
      size: result.size || 0,
      sizeFormatted: formatFileSize(result.size || 0),
      createdDateTime: result.createdDateTime,
      lastModifiedDateTime: result.lastModifiedDateTime,
      message: `File uploaded successfully: ${result.name}`,
    };
  },
});
