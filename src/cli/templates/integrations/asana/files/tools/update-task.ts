import { tool } from "veryfront/tool";
import { z } from "zod";
import { updateTask } from "../../lib/asana-client.ts";

export default tool({
  id: "update-task",
  description: "Update an existing Asana task.",
  inputSchema: z.object({
    taskGid: z.string().describe("The GID of the task to update"),
    name: z.string().optional().describe("New name/title for the task"),
    notes: z.string().optional().describe("New description or notes"),
    completed: z.boolean().optional().describe("Mark the task as completed or not"),
    dueOn: z.string().optional().describe("New due date in YYYY-MM-DD format"),
    assigneeGid: z.string().optional().describe("GID of the user to reassign the task to"),
  }),
  async execute({ taskGid, ...updates }) {
    const task = await updateTask(taskGid, updates);

    return {
      success: true,
      task: {
        gid: task.gid,
        name: task.name,
        completed: task.completed,
        dueOn: task.due_on,
        assignee: task.assignee?.name,
      },
    };
  },
});
