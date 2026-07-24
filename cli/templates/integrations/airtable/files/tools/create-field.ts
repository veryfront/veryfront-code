import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "airtable-create-field",
  description:
    "Create a new field in an Airtable table. Requires schema write permissions.",
  inputSchema: defineSchema((v) =>
    v.object({
      baseId: v.string().describe(
        'The ID of the Airtable base (starts with "app")',
      ),
      tableId: v.string().describe(
        'The ID of the Airtable table (starts with "tbl")',
      ),
      name: v.string().describe("Field name"),
      type: v.string().describe(
        'Airtable field type, such as "singleLineText"',
      ),
      description: v.string().optional().describe("Optional field description"),
      options: v.record(v.string(), v.unknown()).optional().describe(
        "Field type-specific options",
      ),
    })
  )(),
  execute: async (
    { baseId, tableId, name, type, description, options },
    context,
  ) => {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    return await client.createField(baseId, tableId, {
      name,
      type,
      description,
      options,
    });
  },
});
