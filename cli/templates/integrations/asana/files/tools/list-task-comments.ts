import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listTaskComments } from "../../lib/asana-client.ts";

export default tool({
  id: "list-task-comments",
  description: "List comment stories for an Asana task.",
  inputSchema: defineSchema((v) => v.object({
    taskGid: v.string().describe("Asana task GID"),
  }))(),
  async execute({ taskGid }) {
    const comments = await listTaskComments(taskGid);
    return comments.map((story) => ({
      gid: story.gid,
      text: story.text,
      createdAt: story.created_at,
      createdBy: story.created_by?.name,
    }));
  },
});
