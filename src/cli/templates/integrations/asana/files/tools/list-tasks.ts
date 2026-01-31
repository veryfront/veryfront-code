import { tool } from "veryfront/tool";
import { z } from "zod";
import { getMe, listTasks, listWorkspaces } from "../../lib/asana-client.ts";

export default tool({
  id: "list-tasks",
  description:
    "List tasks from Asana. Can filter by project or get tasks assigned to the current user.",
  inputSchema: z.object({
    projectGid: z.string().optional().describe("Project GID to list tasks from"),
    assignedToMe: z
      .boolean()
      .default(false)
      .describe("List tasks assigned to the current user"),
    includeCompleted: z.boolean().default(false).describe("Include completed tasks"),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of tasks to return"),
  }),
  async execute({ projectGid, assignedToMe, includeCompleted, limit }) {
    const completedSince = includeCompleted ? undefined : "now";

    if (!assignedToMe && !projectGid) {
      return {
        tasks: [],
        message: "Please specify either a projectGid or set assignedToMe to true",
      };
    }

    let tasks;

    if (assignedToMe) {
      const me = await getMe();
      const workspaces = await listWorkspaces();
      const workspaceGid = workspaces[0]?.gid;

      if (!workspaceGid) {
        return { tasks: [], message: "No workspaces found" };
      }

      tasks = await listTasks({
        assigneeGid: me.gid,
        workspaceGid,
        completedSince,
      });
    } else {
      tasks = await listTasks({
        projectGid,
        completedSince,
      });
    }

    return tasks.slice(0, limit).map((task) => ({
      gid: task.gid,
      name: task.name,
      completed: task.completed,
      dueOn: task.due_on,
      assignee: task.assignee?.name,
      projects: task.projects.map((p) => p.name),
    }));
  },
});
