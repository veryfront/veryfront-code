import { tool } from "veryfront/tool";
import { z } from "zod";
import { getComments } from "../../lib/figma-client.ts";

export default tool({
  id: "get-comments",
  description:
    "Get all comments on a Figma file. Returns comment threads with messages, authors, timestamps, and resolution status.",
  inputSchema: z.object({
    fileKey: z.string().describe("The file key (from the Figma URL)"),
    includeResolved: z.boolean().default(false).describe("Include resolved comments"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of comments to return"),
  }),
  async execute({ fileKey, includeResolved, limit }): Promise<{
    totalComments: number;
    unresolvedCount: number;
    resolvedCount: number;
    threads: Array<{
      rootComment: {
        id: string;
        message: string;
        author: { handle: string; avatar: string };
        createdAt: string;
        resolvedAt: string | null;
        isResolved: boolean;
        parentId: string | null;
        isReply: boolean;
        location: { nodeIds: string; x: number; y: number } | null;
      };
      replies: Array<{
        id: string;
        message: string;
        author: { handle: string; avatar: string };
        createdAt: string;
        resolvedAt: string | null;
        isResolved: boolean;
        parentId: string | null;
        isReply: boolean;
        location: { nodeIds: string; x: number; y: number } | null;
      }>;
    }>;
    fileUrl: string;
  }> {
    const response = await getComments(fileKey);
    const allComments = includeResolved
      ? response.comments
      : response.comments.filter((comment) => !comment.resolved_at);

    const comments = allComments.slice(0, limit);

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

    const rootComments = formattedComments.filter((c) => !c.isReply);
    const repliesByParentId = new Map<string, typeof formattedComments>();

    for (const comment of formattedComments) {
      if (!comment.parentId) continue;
      const existing = repliesByParentId.get(comment.parentId);
      if (existing) {
        existing.push(comment);
      } else {
        repliesByParentId.set(comment.parentId, [comment]);
      }
    }

    const threads = rootComments.map((root) => ({
      rootComment: root,
      replies: repliesByParentId.get(root.id) ?? [],
    }));

    let unresolvedCount = 0;
    let resolvedCount = 0;

    for (const comment of comments) {
      if (comment.resolved_at) resolvedCount += 1;
      else unresolvedCount += 1;
    }

    return {
      totalComments: comments.length,
      unresolvedCount,
      resolvedCount,
      threads,
      fileUrl: `https://www.figma.com/file/${fileKey}`,
    };
  },
});
