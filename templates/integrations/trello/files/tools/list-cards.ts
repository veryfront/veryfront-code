import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listCards } from "../lib/trello-client.ts";

export default tool({
  id: "trello-list-cards",
  description:
    "List cards from Trello. Can filter by board or list. Provide either boardId or listId.",
  inputSchema: defineSchema((v) => v.object({
    boardId: v.string().optional().describe("Board ID to list cards from"),
    listId: v.string().optional().describe("List ID to list cards from"),
    includeArchived: v
      .boolean()
      .default(false)
      .describe("Include archived/closed cards"),
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of cards to return"),
  }))(),
  async execute({ boardId, listId, includeArchived, limit }) {
    if (!boardId && !listId) {
      return { cards: [], message: "Please specify either a boardId or listId" };
    }

    const cards = await listCards({ boardId, listId, limit });
    const visibleCards = includeArchived
      ? cards
      : cards.filter((card) => !card.closed);

    return visibleCards.map(
      ({
        id,
        name,
        desc,
        url,
        closed,
        idList,
        idBoard,
        due,
        dueComplete,
        labels,
        idMembers,
        dateLastActivity,
      }) => ({
        id,
        name,
        desc,
        url,
        closed,
        idList,
        idBoard,
        due,
        dueComplete,
        labels: labels.map(({ id, name, color }) => ({ id, name, color })),
        memberIds: idMembers,
        lastActivity: dateLastActivity,
      }),
    );
  },
});
