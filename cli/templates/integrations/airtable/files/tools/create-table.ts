import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "airtable-create-table",
  description:
    "Create a new table in an Airtable base. Requires schema write permissions and at least one field definition.",
  inputSchema: defineSchema((v) =>
    v.object({
      baseId: v.string().describe(
        'The ID of the Airtable base (starts with "app")',
      ),
      name: v.string().describe("Name for the new table"),
      description: v.string().optional().describe("Optional table description"),
      fields: v
        .array(v.object({
          name: v.string().describe("Field name"),
          type: v.string().describe(
            'Airtable field type, such as "singleLineText"',
          ),
          description: v.string().optional().describe(
            "Optional field description",
          ),
          options: v.record(v.string(), v.unknown()).optional().describe(
            "Field type-specific options",
          ),
        }))
        .min(1)
        .describe(
          'At least one initial field definition. Example: [{ "name": "Name", "type": "singleLineText" }]',
        ),
    })
  )(),
  execute: async ({ baseId, name, description, fields }, context) => {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    return await client.createTable(baseId, name, fields, { description });
  },
});
