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

    return folders.map(
      ({
        id,
        displayName,
        parentFolderId,
        childFolderCount,
        unreadItemCount,
        totalItemCount,
      }) => ({
        id,
        name: displayName,
        parentFolderId,
        childFolderCount,
        unreadItemCount,
        totalItemCount,
      }),
    );
  },
});
