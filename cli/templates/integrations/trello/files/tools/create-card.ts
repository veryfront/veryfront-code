import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createCard } from "../../lib/trello-client.ts";

export default tool({
  id: "create-card",
  description: "Create a new card in a Trello list.",
  inputSchema: defineSchema((v) => v.object({
    listId: v.string().describe("The ID of the list to create the card in"),
    name: v.string().describe("The name/title of the card"),
    desc: v.string().optional().describe("Description or details for the card"),
    due: v
      .string()
      .optional()
      .describe("Due date in ISO 8601 format (e.g., 2024-12-31T23:59:59.000Z)"),
    pos: v
      .union([v.string(), v.number()])
      .optional()
      .describe('Position of the card: "top", "bottom", or a positive number'),
    idMembers: v
      .array(v.string())
      .optional()
      .describe("Array of member IDs to assign to the card"),
    idLabels: v
      .array(v.string())
      .optional()
      .describe("Array of label IDs to add to the card"),
  }))(),
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
        labels: card.labels.map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
        })),
      },
    };
  },
});
