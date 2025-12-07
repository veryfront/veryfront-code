import { tool } from "veryfront/ai";
import { z } from "zod";
import { getAuthorizedUser, getTeams, listSpaces, listTasks } from "../../lib/clickup-client.ts";

export default tool({
  id: "list-tasks",
  description:
    "List tasks from ClickUp. Can filter by list, folder, space, or get tasks assigned to the current user.",
  inputSchema: z.object({
    listId: z.string().optional().describe("List ID to list tasks from"),
    folderId: z.string().optional().describe("Folder ID to list tasks from"),
    spaceId: z.string().optional().describe("Space ID to list tasks from"),
    assignedToMe: z.boolean().default(false).describe("List tasks assigned to the current user"),
    includeClosed: z.boolean().default(false).describe("Include completed/closed tasks"),
    statuses: z.array(z.string()).optional().describe("Filter by specific status names"),
    orderBy: z.string().optional().describe(
      "Order results by field (e.g., 'due_date', 'created', 'updated')",
    ),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of tasks to return"),
  }),
  async execute({
    listId,
    folderId,
    spaceId,
    assignedToMe,
    includeClosed,
    statuses,
    orderBy,
    limit,
  }) {
    let tasks;

    if (assignedToMe) {
      const user = await getAuthorizedUser();
      const teams = await getTeams();
      if (teams.length === 0) {
        return { tasks: [], message: "No teams found" };
      }

      // Get the first team's first space
      const spaces = await listSpaces(teams[0].id);
      if (spaces.length === 0) {
        return { tasks: [], message: "No spaces found in team" };
      }

      tasks = await listTasks({
        spaceId: spaces[0].id,
        assignees: [user.user.id],
        includeClosed,
        statuses,
        orderBy,
      });
    } else if (listId) {
      tasks = await listTasks({
        listId,
        includeClosed,
        statuses,
        orderBy,
      });
    } else if (folderId) {
      tasks = await listTasks({
        folderId,
        includeClosed,
        statuses,
        orderBy,
      });
    } else if (spaceId) {
      tasks = await listTasks({
        spaceId,
        includeClosed,
        statuses,
        orderBy,
      });
    } else {
      return {
        tasks: [],
        message:
          "Please specify either a listId, folderId, spaceId, or set assignedToMe to true",
      };
    }

    return tasks.slice(0, limit).map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status.status,
      dueDate: task.due_date ? new Date(parseInt(task.due_date)).toISOString() : null,
      priority: task.priority?.priority || "none",
      assignees: task.assignees.map((a) => a.username),
      tags: task.tags.map((t) => t.name),
      list: task.list.name,
      folder: task.folder.name,
      space: task.space.name,
    }));
  },
});
