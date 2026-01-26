import { tool } from "veryfront/tool";
import { z } from "zod";
import {
  getTeams,
  listFolders,
  listFolderlessLists,
  listLists,
  listSpaces,
} from "../../lib/clickup-client.ts";

type ClickUpList = {
  id: string;
  name: string;
  task_count: number;
  due_date?: string | null;
  status?: { status?: string | null } | null;
  priority?: { priority?: string | null } | null;
  assignee?: { username?: string | null } | null;
  folder: { name: string };
  space: { name: string };
  archived: boolean;
};

function mapList(list: ClickUpList, folderName?: string): {
  id: string;
  name: string;
  taskCount: number;
  dueDate: string | null;
  status: string;
  priority: string;
  assignee: string | null;
  folder: string;
  space: string;
  archived: boolean;
} {
  return {
    id: list.id,
    name: list.name,
    taskCount: list.task_count,
    dueDate: list.due_date ? new Date(parseInt(list.due_date)).toISOString() : null,
    status: list.status?.status || "active",
    priority: list.priority?.priority || "none",
    assignee: list.assignee?.username || null,
    folder: folderName ?? list.folder.name,
    space: list.space.name,
    archived: list.archived,
  };
}

export default tool({
  id: "list-lists",
  description: "List all lists in ClickUp. Can filter by folder or space. Lists are containers for tasks.",
  inputSchema: z.object({
    folderId: z.string().optional().describe("Folder ID to list lists from"),
    spaceId: z.string().optional().describe("Space ID to list folderless lists from"),
    includeAll: z
      .boolean()
      .default(false)
      .describe("List all lists from all folders in the first space"),
  }),
  async execute({ folderId, spaceId, includeAll }) {
    if (folderId) {
      const lists = await listLists(folderId);
      return lists.map((list) => mapList(list));
    }

    if (spaceId) {
      const lists = await listFolderlessLists(spaceId);
      return lists.map((list) => mapList(list));
    }

    if (!includeAll) {
      return {
        lists: [],
        message: "Please specify either a folderId, spaceId, or set includeAll to true",
      };
    }

    const teams = await getTeams();
    if (teams.length === 0) return { lists: [], message: "No teams found" };

    const spaces = await listSpaces(teams[0].id);
    if (spaces.length === 0) return { lists: [], message: "No spaces found in team" };

    const firstSpace = spaces[0];
    const [folders, folderlessLists] = await Promise.all([
      listFolders(firstSpace.id),
      listFolderlessLists(firstSpace.id),
    ]);

    const allLists = folderlessLists.map((list) => mapList(list, "No Folder"));

    for (const folder of folders) {
      const lists = await listLists(folder.id);
      allLists.push(...lists.map((list) => mapList(list, folder.name)));
    }

    return allLists;
  },
});
