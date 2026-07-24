import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "airtable-update-table",
  description:
    "Update Airtable table metadata, such as name or description. Uses the table ID for stable updates.",
  inputSchema: defineSchema((v) =>
    v.object({
      baseId: v.string().describe(
        'The ID of the Airtable base (starts with "app")',
      ),
      tableId: v.string().describe(
        'The ID of the Airtable table (starts with "tbl")',
      ),
      name: v.string().optional().describe("New table name"),
      description: v.string().optional().describe("New table description"),
    })
  )(),
  execute: async ({ baseId, tableId, name, description }, context) => {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    return await client.updateTable(baseId, tableId, { name, description });
  },
});
