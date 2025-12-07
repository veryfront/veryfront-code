import { tool } from "veryfront/ai";
import { z } from "zod";
import { getBase } from "../../lib/airtable-client.ts";

export default tool({
  id: "get-base",
  description:
    "Get the schema and structure of an Airtable base, including all tables, fields, and views. Useful for understanding the data model before querying or creating records.",
  inputSchema: z.object({
    baseId: z.string().describe('The ID of the Airtable base (starts with "app")'),
  }),
  async execute({ baseId }) {
    const schema = await getBase(baseId);

    return {
      tables: schema.tables.map((table) => ({
        id: table.id,
        name: table.name,
        primaryFieldId: table.primaryFieldId,
        fields: table.fields.map((field) => ({
          id: field.id,
          name: field.name,
          type: field.type,
          options: field.options,
        })),
        views: table.views.map((view) => ({
          id: view.id,
          name: view.name,
          type: view.type,
        })),
      })),
    };
  },
});
