import { tool } from "veryfront/tool";
import { z } from "zod";
import { createCard } from "../../lib/trello-client.ts";

export default tool({
  id: "create-card",
  description: "Create a new card in a Trello list.",
  inputSchema: z.object({
    listId: z.string().describe("The ID of the list to create the card in"),
    name: z.string().describe("The name/title of the card"),
    desc: z.string().optional().describe("Description or details for the card"),
    due: z
      .string()
      .optional()
      .describe("Due date in ISO 8601 format (e.g., 2024-12-31T23:59:59.000Z)"),
    pos: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Position of the card: "top", "bottom", or a positive number'),
    idMembers: z
      .array(z.string())
      .optional()
      .describe("Array of member IDs to assign to the card"),
    idLabels: z
      .array(z.string())
      .optional()
      .describe("Array of label IDs to add to the card"),
  }),
  async execute({ listId, name, desc, due, pos, idMembers, idLabels }) {
    const card = await createCard({
      listId,
      name,
      desc,
      due,
      pos,
      idMembers,
      idLabels,
    });

    return {
      success: true,
      card: {
        id: card.id,
        name: card.name,
        desc: card.desc,
        url: card.url,
        idList: card.idList,
        due: card.due,
        labels: card.labels.map(({ id, name, color }) => ({ id, name, color })),
      },
    };
  },
});
