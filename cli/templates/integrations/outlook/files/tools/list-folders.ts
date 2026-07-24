import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOutlookClient } from "../lib/outlook-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "outlook-list-folders",
  description:
    "List all mail folders in the mailbox, including inbox, sent items, drafts, and custom folders.",
  inputSchema: defineSchema((v) => v.object({}))(),
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOutlookClient(userId);
    const folders = await client.listFolders();

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
