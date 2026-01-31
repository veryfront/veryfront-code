import { tool } from "veryfront/tool";
import { z } from "zod";
import { updateCard } from "../../lib/trello-client.ts";

export default tool({
  id: "update-card",
  description: "Update an existing Trello card.",
  inputSchema: z.object({
    cardId: z.string().describe("The ID of the card to update"),
    name: z.string().optional().describe("New name/title for the card"),
    desc: z.string().optional().describe("New description or details"),
    closed: z.boolean().optional().describe("Archive or unarchive the card"),
    idList: z.string().optional().describe("Move the card to a different list by list ID"),
    due: z
      .string()
      .nullable()
      .optional()
      .describe("New due date in ISO 8601 format, or null to remove due date"),
    dueComplete: z.boolean().optional().describe("Mark the due date as complete or incomplete"),
    pos: z
      .union([z.string(), z.number()])
      .optional()
      .describe('New position: "top", "bottom", or a positive number'),
    idMembers: z
      .array(z.string())
      .optional()
      .describe("Array of member IDs to assign to the card (replaces existing)"),
    idLabels: z
      .array(z.string())
      .optional()
      .describe("Array of label IDs for the card (replaces existing)"),
  }),
  async execute({ cardId, ...updates }) {
    const {
      id,
      name,
      desc,
      url,
      closed,
      idList,
      due,
      dueComplete,
      labels,
    } = await updateCard(cardId, updates);

    return {
      success: true,
      card: {
        id,
        name,
        desc,
        url,
        closed,
        idList,
        due,
        dueComplete,
        labels: labels.map(({ id, name, color }) => ({ id, name, color })),
      },
    };
  },
});
