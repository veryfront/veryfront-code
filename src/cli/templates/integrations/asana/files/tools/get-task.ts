import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTask } from "../../lib/asana-client.ts";

export default tool({
  id: "get-task",
  description: "Get details of a specific Asana task by its GID.",
  inputSchema: z.object({
    taskGid: z.string().describe("The GID of the task to retrieve"),
  }),
  async execute({ taskGid }) {
    const task = await getTask(taskGid);

    return {
      gid: task.gid,
      name: task.name,
      notes: task.notes,
      completed: task.completed,
      dueOn: task.due_on,
      assignee: task.assignee?.name,
      projects: task.projects.map((p) => ({ gid: p.gid, name: p.name })),
      createdAt: task.created_at,
      modifiedAt: task.modified_at,
    };
  },
});
