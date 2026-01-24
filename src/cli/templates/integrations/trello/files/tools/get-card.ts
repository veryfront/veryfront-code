import { tool } from "veryfront/tool";
import { z } from "zod";
import { getCard } from "../../lib/trello-client.ts";

export default tool({
  id: "get-card",
  description: "Get details of a specific Trello card by its ID.",
  inputSchema: z.object({
    cardId: z.string().describe("The ID of the card to retrieve"),
  }),
  async execute({ cardId }) {
    const {
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
    } = await getCard(cardId);

    return {
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
    };
  },
});
