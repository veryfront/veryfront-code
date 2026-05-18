import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { addTaskComment } from "../../lib/asana-client.ts";

export default tool({
  id: "add-task-comment",
  description: "Add a comment to an Asana task.",
  inputSchema: defineSchema((v) => v.object({
    taskGid: v.string().describe("Asana task GID"),
    text: v.string().min(1).describe("Comment text"),
  }))(),
  async execute({ taskGid, text }) {
    const story = await addTaskComment({ taskGid, text });
    return {
      gid: story.gid,
      type: story.type,
      text: story.text,
      createdAt: story.created_at,
      createdBy: story.created_by?.name,
    };
  },
});
