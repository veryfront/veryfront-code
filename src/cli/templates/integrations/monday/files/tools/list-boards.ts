import { tool } from "veryfront/tool";
import { z } from "zod";
import { listBoards } from "../../lib/monday-client.ts";

export default tool({
  id: "list-boards",
  description: "List all boards in Monday.com. Can optionally filter by workspace IDs.",
  inputSchema: z.object({
    workspaceIds: z
      .array(z.string())
      .optional()
      .describe("Optional list of workspace IDs to filter boards"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of boards to return"),
    page: z.number().min(1).default(1).describe("Page number for pagination"),
  }),
  async execute({ workspaceIds, limit, page }) {
    const boards = await listBoards({ workspaceIds, limit, page });

    return boards.map((board) => ({
      id: board.id,
      name: board.name,
      description: board.description,
      boardKind: board.board_kind,
      state: board.state,
      workspaceId: board.workspace_id,
    }));
  },
});
