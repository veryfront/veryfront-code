import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "get-base",
  description:
    "Get the schema and structure of an Airtable base, including all tables, fields, and views. Useful for understanding the data model before querying or creating records.",
  inputSchema: defineSchema((v) =>
    v.object({
      baseId: v.string().describe(
        'The ID of the Airtable base (starts with "app")',
      ),
    })
  )(),
  async execute({ baseId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    const { tables } = await client.getBase(baseId);

    return {
      tables: tables.map((table) => ({
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
