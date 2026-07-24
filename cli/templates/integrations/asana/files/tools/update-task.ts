import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-update-task",
  description: "Update an existing Asana task.",
  inputSchema: defineSchema((v) =>
    v.object({
      taskGid: v.string().describe("The GID of the task to update"),
      name: v.string().optional().describe("New name/title for the task"),
      notes: v.string().optional().describe("New description or notes"),
      completed: v.boolean().optional().describe(
        "Mark the task as completed or not",
      ),
      dueOn: v.string().optional().describe(
        "New due date in YYYY-MM-DD format",
      ),
      assigneeGid: v.string().optional().describe(
        "GID of the user to reassign the task to",
      ),
    })
  )(),
  async execute({ taskGid, ...updates }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const task = await client.updateTask(taskGid, updates);

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
