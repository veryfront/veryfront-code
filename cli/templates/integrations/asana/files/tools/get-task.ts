import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "get-task",
  description: "Get details of a specific Asana task by its GID.",
  inputSchema: defineSchema((v) =>
    v.object({
      taskGid: v.string().describe("The GID of the task to retrieve"),
    })
  )(),
  async execute({ taskGid }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const task = await client.getTask(taskGid);

    return {
      gid: task.gid,
      name: task.name,
      notes: task.notes,
      completed: task.completed,
      dueOn: task.due_on,
      assignee: task.assignee?.name,
      projects: task.projects.map(({ gid, name }) => ({ gid, name })),
      createdAt: task.created_at,
      modifiedAt: task.modified_at,
    };
  },
});
