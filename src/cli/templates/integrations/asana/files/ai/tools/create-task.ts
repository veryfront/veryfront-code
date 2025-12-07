import { tool } from "veryfront/ai";
import { z } from "zod";
import { createTask } from "../../lib/asana-client.ts";

export default tool({
  id: "create-task",
  description: "Create a new task in an Asana project.",
  inputSchema: z.object({
    projectGid: z.string().describe("The GID of the project to create the task in"),
    name: z.string().describe("The name/title of the task"),
    notes: z.string().optional().describe("Description or notes for the task"),
    dueOn: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    assigneeGid: z.string().optional().describe("GID of the user to assign the task to"),
  }),
  async execute({ projectGid, name, notes, dueOn, assigneeGid }) {
    const task = await createTask({
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
