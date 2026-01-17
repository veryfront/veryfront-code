import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatFileSize, uploadFile } from "../../lib/dropbox-client.ts";

export default tool({
  id: "upload-file",
  description:
    "Upload or update a file in Dropbox. Can create new files or overwrite existing ones.",
  inputSchema: z.object({
    path: z.string().describe(
      'Full path where the file should be saved in Dropbox (e.g., "/Documents/notes.txt")',
    ),
    content: z.string().describe("The content to write to the file"),
    mode: z.enum(["add", "overwrite", "update"]).default("add").describe(
      'Upload mode: "add" (fail if exists), "overwrite" (replace if exists), "update" (update specific revision)',
    ),
    autorename: z.boolean().default(false).describe(
      "If true and file exists, automatically rename to avoid conflicts",
    ),
  }),
  async execute({ path, content, mode, autorename }) {
    // Validate path
    if (!path.startsWith("/")) {
      throw new Error('Path must start with "/" (e.g., "/Documents/file.txt")');
    }

    // Upload the file
    const result = await uploadFile(path, content, {
      mode,
      autorename,
      mute: false,
    });

    return {
      success: true,
      name: result.name,
      path: result.path_display || result.path_lower || "",
      id: result.id,
      size: result.size,
      sizeFormatted: formatFileSize(result.size),
      modified: result.server_modified,
      rev: result.rev,
      message: mode === "add"
        ? `File created successfully at ${result.path_display}`
        : `File updated successfully at ${result.path_display}`,
    };
  },
});
