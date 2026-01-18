import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTask } from "../../lib/clickup-client.ts";

export default tool({
  id: "get-task",
  description: "Get detailed information about a specific ClickUp task by ID.",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to retrieve"),
    includeSubtasks: z.boolean().default(false).describe("Include subtasks in the response"),
    customTaskIds: z.boolean().default(false).describe(
      "Use custom task IDs instead of internal IDs",
    ),
    teamId: z.string().optional().describe("Team ID (required when using custom task IDs)"),
  }),
  async execute({ taskId, includeSubtasks, customTaskIds, teamId }) {
    const task = await getTask(taskId, {
      includeSubtasks,
      customTaskIds,
      teamId,
    });

    return {
      id: task.id,
      name: task.name,
      description: task.description,
      status: task.status.status,
      priority: task.priority?.priority || "none",
      dueDate: task.due_date ? new Date(parseInt(task.due_date)).toISOString() : null,
      startDate: task.start_date ? new Date(parseInt(task.start_date)).toISOString() : null,
      dateCreated: task.date_created,
      dateUpdated: task.date_updated,
      dateClosed: task.date_closed,
      creator: {
        id: task.creator.id,
        username: task.creator.username,
        email: task.creator.email,
      },
      assignees: task.assignees.map((assignee) => ({
        id: assignee.id,
        username: assignee.username,
        email: assignee.email,
      })),
      tags: task.tags.map((tag) => tag.name),
      list: {
        id: task.list.id,
        name: task.list.name,
      },
      folder: {
        id: task.folder.id,
        name: task.folder.name,
      },
      space: {
        id: task.space.id,
        name: task.space.name,
      },
    };
  },
});
