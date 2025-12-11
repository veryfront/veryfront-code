import { tool } from "veryfront/ai";
import { z } from "zod";
import { getComments } from "../../lib/figma-client.ts";

export default tool({
  id: "get-comments",
  description:
    "Get all comments on a Figma file. Returns comment threads with messages, authors, timestamps, and resolution status.",
  inputSchema: z.object({
    fileKey: z.string().describe("The file key (from the Figma URL)"),
    includeResolved: z.boolean().default(false).describe("Include resolved comments"),
    limit: z.number().min(1).max(100).default(50).describe("Maximum number of comments to return"),
  }),
  async execute({ fileKey, includeResolved, limit }) {
    const response = await getComments(fileKey);
    let comments = response.comments;

    if (!includeResolved) {
      comments = comments.filter((comment) => !comment.resolved_at);
    }

    comments = comments.slice(0, limit);

    const formattedComments = comments.map((comment) => ({
      id: comment.id,
      message: comment.message,
      author: {
        handle: comment.user.handle,
        avatar: comment.user.img_url,
      },
      createdAt: comment.created_at,
      resolvedAt: comment.resolved_at,
      isResolved: !!comment.resolved_at,
      parentId: comment.parent_id,
      isReply: !!comment.parent_id,
      location: comment.client_meta.node_id
        ? {
          nodeIds: comment.client_meta.node_id,
          x: comment.client_meta.x,
          y: comment.client_meta.y,
        }
        : null,
    }));

    const threads: Array<{
      rootComment: typeof formattedComments[0];
      replies: typeof formattedComments;
    }> = [];

    const rootComments = formattedComments.filter((c) => !c.isReply);

    for (const root of rootComments) {
      const replies = formattedComments.filter((c) => c.parentId === root.id);
      threads.push({
        rootComment: root,
        replies,
      });
    }

    return {
      totalComments: comments.length,
      unresolvedCount: comments.filter((c) => !c.resolved_at).length,
      resolvedCount: comments.filter((c) => c.resolved_at).length,
      threads,
      fileUrl: `https://www.figma.com/file/${fileKey}`,
    };
  },
});
