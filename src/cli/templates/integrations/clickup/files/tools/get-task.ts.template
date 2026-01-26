import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTask } from "../../lib/clickup-client.ts";

function toIsoDate(value?: string | null): string | null {
  if (!value) return null;
  return new Date(Number.parseInt(value, 10)).toISOString();
}

export default tool({
  id: "get-task",
  description: "Get detailed information about a specific ClickUp task by ID.",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to retrieve"),
    includeSubtasks: z.boolean().default(false).describe("Include subtasks in the response"),
    customTaskIds: z.boolean().default(false).describe("Use custom task IDs instead of internal IDs"),
    teamId: z.string().optional().describe("Team ID (required when using custom task IDs)"),
  }),
  async execute({ taskId, includeSubtasks, customTaskIds, teamId }) {
    const task = await getTask(taskId, { includeSubtasks, customTaskIds, teamId });

    return {
      id: task.id,
      name: task.name,
      description: task.description,
      status: task.status.status,
      priority: task.priority?.priority ?? "none",
      dueDate: toIsoDate(task.due_date),
      startDate: toIsoDate(task.start_date),
      dateCreated: task.date_created,
      dateUpdated: task.date_updated,
      dateClosed: task.date_closed,
      creator: {
        id: task.creator.id,
        username: task.creator.username,
        email: task.creator.email,
      },
      assignees: task.assignees.map(({ id, username, email }) => ({ id, username, email })),
      tags: task.tags.map(({ name }) => name),
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
