import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-list-tasks",
  description:
    "List tasks from Asana. Can filter by project or get tasks assigned to the current user.",
  inputSchema: defineSchema((v) =>
    v.object({
      projectGid: v.string().optional().describe(
        "Project GID to list tasks from",
      ),
      assignedToMe: v
        .boolean()
        .default(false)
        .describe("List tasks assigned to the current user"),
      includeCompleted: v.boolean().default(false).describe(
        "Include completed tasks",
      ),
      limit: v.number().min(1).max(50).default(20).describe(
        "Maximum number of tasks to return",
      ),
    })
  )(),
  async execute(
    { projectGid, assignedToMe, includeCompleted, limit },
    context,
  ) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const completedSince = includeCompleted ? undefined : "now";

    if (!assignedToMe && !projectGid) {
      return {
        tasks: [],
        message:
          "Please specify either a projectGid or set assignedToMe to true",
      };
    }

    let tasks;

    if (assignedToMe) {
      const me = await client.getMe();
      const workspaces = await client.listWorkspaces();
      const workspaceGid = workspaces[0]?.gid;

      if (!workspaceGid) {
        return { tasks: [], message: "No workspaces found" };
      }

      tasks = await client.listTasks({
        assigneeGid: me.gid,
        workspaceGid,
        completedSince,
      });
    } else {
      tasks = await client.listTasks({
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
