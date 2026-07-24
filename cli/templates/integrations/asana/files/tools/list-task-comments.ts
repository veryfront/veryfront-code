import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAsanaClient } from "../lib/asana-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "asana-list-task-comments",
  description: "List comment stories for an Asana task.",
  inputSchema: defineSchema((v) =>
    v.object({
      taskGid: v.string().describe("Asana task GID"),
    })
  )(),
  async execute({ taskGid }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAsanaClient(userId);
    const comments = await client.listTaskComments(taskGid);
    return comments.map((story) => ({
      gid: story.gid,
      text: story.text,
      createdAt: story.created_at,
      createdBy: story.created_by?.name,
    }));
  },
});
