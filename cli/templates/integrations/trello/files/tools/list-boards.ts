import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listBoards } from "../../lib/trello-client.ts";

export default tool({
  id: "list-boards",
  description: "List all Trello boards accessible to the current user.",
  inputSchema: defineSchema((v) => v.object({
    includeArchived: v
      .boolean()
      .default(false)
      .describe("Include archived/closed boards"),
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of boards to return"),
  }))(),
  async execute({ includeArchived, limit }) {
    const boards = await listBoards();

    const visibleBoards = includeArchived
      ? boards
      : boards.filter((board) => !board.closed);

    return visibleBoards.slice(0, limit).map((board) => ({
      id: board.id,
      name: board.name,
      desc: board.desc,
      url: board.url,
      closed: board.closed,
      backgroundColor: board.prefs?.backgroundColor,
      lastActivity: board.dateLastActivity,
    }));
  },
});
