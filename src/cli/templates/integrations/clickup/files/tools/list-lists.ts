import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTeams, listFolders, listFolderlessLists, listLists, listSpaces } from "../../lib/clickup-client.ts";

export default tool({
  id: "list-lists",
  description:
    "List all lists in ClickUp. Can filter by folder or space. Lists are containers for tasks.",
  inputSchema: z.object({
    folderId: z.string().optional().describe("Folder ID to list lists from"),
    spaceId: z.string().optional().describe("Space ID to list folderless lists from"),
    includeAll: z.boolean().default(false).describe(
      "List all lists from all folders in the first space",
    ),
  }),
  async execute({ folderId, spaceId, includeAll }) {
    if (folderId) {
      const lists = await listLists(folderId);
      return lists.map((list) => ({
        id: list.id,
        name: list.name,
        taskCount: list.task_count,
        dueDate: list.due_date ? new Date(parseInt(list.due_date)).toISOString() : null,
        status: list.status?.status || "active",
        priority: list.priority?.priority || "none",
        assignee: list.assignee?.username || null,
        folder: list.folder.name,
        space: list.space.name,
        archived: list.archived,
      }));
    }

    if (spaceId) {
      const lists = await listFolderlessLists(spaceId);
      return lists.map((list) => ({
        id: list.id,
        name: list.name,
        taskCount: list.task_count,
        dueDate: list.due_date ? new Date(parseInt(list.due_date)).toISOString() : null,
        status: list.status?.status || "active",
        priority: list.priority?.priority || "none",
        assignee: list.assignee?.username || null,
        folder: list.folder.name,
        space: list.space.name,
        archived: list.archived,
      }));
    }

    if (includeAll) {
      const teams = await getTeams();
      if (teams.length === 0) {
        return { lists: [], message: "No teams found" };
      }

      const spaces = await listSpaces(teams[0].id);
      if (spaces.length === 0) {
        return { lists: [], message: "No spaces found in team" };
      }

      const firstSpace = spaces[0];
      const folders = await listFolders(firstSpace.id);
      const folderlessLists = await listFolderlessLists(firstSpace.id);

      const allLists = [];

      // Add folderless lists
      allLists.push(
        ...folderlessLists.map((list) => ({
          id: list.id,
          name: list.name,
          taskCount: list.task_count,
          dueDate: list.due_date ? new Date(parseInt(list.due_date)).toISOString() : null,
          status: list.status?.status || "active",
          priority: list.priority?.priority || "none",
          assignee: list.assignee?.username || null,
          folder: "No Folder",
          space: list.space.name,
          archived: list.archived,
        })),
      );

      // Add lists from each folder
      for (const folder of folders) {
        const lists = await listLists(folder.id);
        allLists.push(
          ...lists.map((list) => ({
            id: list.id,
            name: list.name,
            taskCount: list.task_count,
            dueDate: list.due_date ? new Date(parseInt(list.due_date)).toISOString() : null,
            status: list.status?.status || "active",
            priority: list.priority?.priority || "none",
            assignee: list.assignee?.username || null,
            folder: folder.name,
            space: list.space.name,
            archived: list.archived,
          })),
        );
      }

      return allLists;
    }

    return {
      lists: [],
      message: "Please specify either a folderId, spaceId, or set includeAll to true",
    };
  },
});
