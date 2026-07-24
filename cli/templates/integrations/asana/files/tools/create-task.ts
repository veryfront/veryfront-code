import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-create-task",
  description: "Create a new task in an Asana project.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectGid: v.string().describe(
        "The GID of the project to create the task in",
      ),
      name: v.string().describe("The name/title of the task"),
      notes: v.string().optional().describe(
        "Description or notes for the task",
      ),
      dueOn: v.string().optional().describe("Due date in YYYY-MM-DD format"),
      assigneeGid: v.string().optional().describe(
        "GID of the user to assign the task to",
      ),
    })
  )(),
  async execute({ projectGid, name, notes, dueOn, assigneeGid }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const task = await client.createTask({
      projectGid,
      name,
      notes,
      dueOn,
      assigneeGid,
    });

    return {
      success: true,
      task: {
        gid: task.gid,
        name: task.name,
        dueOn: task.due_on,
        assignee: task.assignee?.name,
      },
    };
  },
});
