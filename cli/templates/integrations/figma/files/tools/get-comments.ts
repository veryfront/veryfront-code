import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createFigmaClient } from "../lib/figma-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

type FormattedComment = {
  id: string;
  message: string;
  author: { handle: string; avatar: string };
  createdAt: string;
  resolvedAt: string | null;
  isResolved: boolean;
  parentId: string | null;
  isReply: boolean;
  location: { nodeIds: string[]; x?: number; y?: number } | null;
};

type Output = {
  totalComments: number;
  unresolvedCount: number;
  resolvedCount: number;
  threads: Array<{
    rootComment: FormattedComment;
    replies: FormattedComment[];
  }>;
  fileUrl: string;
};

export default tool({
  id: "get-comments",
  description:
    "Get all comments on a Figma file. Returns comment threads with messages, authors, timestamps, and resolution status.",
  inputSchema: defineSchema((v) =>
    v.object({
      fileKey: v.string().describe("The file key (from the Figma URL)"),
      includeResolved: v.boolean().default(false).describe(
        "Include resolved comments",
      ),
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum number of comments to return"),
    })
  )(),
  async execute({ fileKey, includeResolved, limit }, context): Promise<Output> {
    const userId = requireUserIdFromContext(context);
    const client = createFigmaClient(userId);
    const response = await client.getComments(fileKey);

    const filteredComments = includeResolved
      ? response.comments
      : response.comments.filter((comment) => !comment.resolved_at);

    const comments = filteredComments.slice(0, limit);

    const formattedComments: FormattedComment[] = comments.map((comment) => ({
      id: comment.id,
      message: comment.message,
      author: {
        handle: comment.user.handle,
        avatar: comment.user.img_url,
      },
      createdAt: comment.created_at,
      resolvedAt: comment.resolved_at ?? null,
      isResolved: Boolean(comment.resolved_at),
      parentId: comment.parent_id ?? null,
      isReply: Boolean(comment.parent_id),
      location: comment.client_meta.node_id
        ? {
          nodeIds: comment.client_meta.node_id,
          x: comment.client_meta.x,
          y: comment.client_meta.y,
        }
        : null,
    }));

    const rootComments = formattedComments.filter((comment) =>
      !comment.isReply
    );

    const repliesByParentId = new Map<string, FormattedComment[]>();
    for (const comment of formattedComments) {
      if (!comment.parentId) continue;
      const replies = repliesByParentId.get(comment.parentId);
      if (replies) replies.push(comment);
      else repliesByParentId.set(comment.parentId, [comment]);
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
