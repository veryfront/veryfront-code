import { tool } from "veryfront/tool";
import { z } from "zod";
import { listCards } from "../../lib/trello-client.ts";

export default tool({
  id: "list-cards",
  description:
    "List cards from Trello. Can filter by board or list. Provide either boardId or listId.",
  inputSchema: z.object({
    boardId: z.string().optional().describe("Board ID to list cards from"),
    listId: z.string().optional().describe("List ID to list cards from"),
    includeArchived: z
      .boolean()
      .default(false)
      .describe("Include archived/closed cards"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of cards to return"),
  }),
  async execute({ boardId, listId, includeArchived, limit }) {
    if (!boardId && !listId) {
      return { cards: [], message: "Please specify either a boardId or listId" };
    }

    const cards = await listCards({ boardId, listId, limit });

    const visibleCards = includeArchived
      ? cards
      : cards.filter((card) => !card.closed);

    return visibleCards.map((card) => ({
      id: card.id,
      name: card.name,
      desc: card.desc,
      url: card.url,
      closed: card.closed,
      idList: card.idList,
      idBoard: card.idBoard,
      due: card.due,
      dueComplete: card.dueComplete,
      labels: card.labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      memberIds: card.idMembers,
      lastActivity: card.dateLastActivity,
    }));
  },
});
