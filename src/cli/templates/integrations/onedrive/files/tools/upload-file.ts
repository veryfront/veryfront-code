import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatFileSize, uploadFile } from "../../lib/onedrive-client.ts";

export default tool({
  id: "upload-file",
  description:
    "Upload or update a file in OneDrive. Can create new files or overwrite existing ones.",
  inputSchema: z.object({
    fileName: z
      .string()
      .describe("Name of the file to upload (e.g., 'notes.txt', 'document.pdf')"),
    content: z.string().describe("The content to write to the file"),
    parentFolderId: z
      .string()
      .default("root")
      .describe('Parent folder ID where the file should be uploaded (default: "root")'),
  }),
  async execute({ fileName, content, parentFolderId }) {
    const trimmedName = fileName.trim();

    if (!trimmedName) {
      throw new Error("Filename cannot be empty");
    }

    if (trimmedName.includes("/") || trimmedName.includes("\\")) {
      throw new Error("Filename cannot contain path separators");
    }

    const result = await uploadFile(trimmedName, content, parentFolderId);
    const size = result.size ?? 0;

    return {
      success: true,
      id: result.id,
      name: result.name,
      webUrl: result.webUrl,
      size,
      sizeFormatted: formatFileSize(size),
      createdDateTime: result.createdDateTime,
      lastModifiedDateTime: result.lastModifiedDateTime,
      message: `File uploaded successfully: ${result.name}`,
    };
  },
});
