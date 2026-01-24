import { tool } from "veryfront/tool";
import { z } from "zod";
import { postComment } from "../../lib/figma-client.ts";

export default tool({
  id: "post-comment",
  description:
    "Post a comment on a Figma file. Can be a new comment or a reply to an existing comment thread.",
  inputSchema: z.object({
    fileKey: z.string().describe("The file key (from the Figma URL)"),
    message: z.string().min(1).describe("The comment message to post"),
    parentId: z
      .string()
      .optional()
      .describe("ID of parent comment to reply to (for threaded replies)"),
    nodeId: z.string().optional().describe("ID of the Figma node to attach the comment to"),
    x: z.number().optional().describe("X coordinate for comment placement (0-1, relative to canvas)"),
    y: z.number().optional().describe("Y coordinate for comment placement (0-1, relative to canvas)"),
  }),
  async execute({ fileKey, message, parentId, nodeId, x, y }) {
    const clientMeta: { x?: number; y?: number; node_id?: string[] } = {
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
      ...(nodeId ? { node_id: [nodeId] } : {}),
    };

    const comment = await postComment(fileKey, message, {
      client_meta: Object.keys(clientMeta).length ? clientMeta : undefined,
      parent_id: parentId,
    });

    return {
      success: true,
      comment: {
        id: comment.id,
        message: comment.message,
        author: {
          handle: comment.user.handle,
          avatar: comment.user.img_url,
        },
        createdAt: comment.created_at,
        isReply: Boolean(comment.parent_id),
        fileUrl: `https://www.figma.com/file/${fileKey}`,
      },
    };
  },
});
