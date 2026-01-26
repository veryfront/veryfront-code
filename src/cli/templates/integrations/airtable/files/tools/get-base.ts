import { tool } from "veryfront/tool";
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
    const { tables } = await getBase(baseId);

    return {
      tables: tables.map(({ id, name, primaryFieldId, fields, views }) => ({
        id,
        name,
        primaryFieldId,
        fields: fields.map(({ id, name, type, options }) => ({
          id,
          name,
          type,
          options,
        })),
        views: views.map(({ id, name, type }) => ({
          id,
          name,
          type,
        })),
      })),
    };
  },
});
