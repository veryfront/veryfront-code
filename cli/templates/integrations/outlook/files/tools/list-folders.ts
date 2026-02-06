import { tool } from "veryfront/tool";
import { z } from "zod";
import { listFolders } from "../../lib/outlook-client.ts";

export default tool({
  id: "list-folders",
  description:
    "List all mail folders in the mailbox, including inbox, sent items, drafts, and custom folders.",
  inputSchema: z.object({}),
  async execute() {
    const folders = await listFolders();

    return folders.map((folder) => ({
      id: folder.id,
      name: folder.displayName,
      parentFolderId: folder.parentFolderId,
      childFolderCount: folder.childFolderCount,
      unreadItemCount: folder.unreadItemCount,
      totalItemCount: folder.totalItemCount,
    }));
  },
});
