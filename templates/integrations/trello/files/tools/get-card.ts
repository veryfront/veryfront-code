import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getCard } from "../lib/trello-client.ts";

export default tool({
  id: "trello-get-card",
  description: "Get details of a specific Trello card by its ID.",
  inputSchema: defineSchema((v) => v.object({
    cardId: v.string().describe("The ID of the card to retrieve"),
  }))(),
  async execute({ cardId }) {
    const card = await getCard(cardId);

    return {
      id: card.id,
      name: card.name,
      desc: card.desc,
      url: card.url,
      closed: card.closed,
      idList: card.idList,
      idBoard: card.idBoard,
      due: card.due,
      dueComplete: card.dueComplete,
      labels: card.labels.map(({ id, name, color }) => ({ id, name, color })),
      memberIds: card.idMembers,
      lastActivity: card.dateLastActivity,
    };
  },
});
