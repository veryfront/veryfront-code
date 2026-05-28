import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { updateCard } from "../../lib/trello-client.ts";

export default tool({
  id: "update-card",
  description: "Update an existing Trello card.",
  inputSchema: defineSchema((v) => v.object({
    cardId: v.string().describe("The ID of the card to update"),
    name: v.string().optional().describe("New name/title for the card"),
    desc: v.string().optional().describe("New description or details"),
    closed: v.boolean().optional().describe("Archive or unarchive the card"),
    idList: v.string().optional().describe("Move the card to a different list by list ID"),
    due: v
      .string()
      .nullable()
      .optional()
      .describe("New due date in ISO 8601 format, or null to remove due date"),
    dueComplete: v.boolean().optional().describe("Mark the due date as complete or incomplete"),
    pos: v
      .union([v.string(), v.number()])
      .optional()
      .describe('New position: "top", "bottom", or a positive number'),
    idMembers: v
      .array(v.string())
      .optional()
      .describe("Array of member IDs to assign to the card (replaces existing)"),
    idLabels: v
      .array(v.string())
      .optional()
      .describe("Array of label IDs for the card (replaces existing)"),
  }))(),
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
