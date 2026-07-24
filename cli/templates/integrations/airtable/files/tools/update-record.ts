import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "airtable-update-record",
  description:
    "Update fields on an existing Airtable record. Returns the updated record with all visible fields.",
  inputSchema: defineSchema((v) =>
    v.object({
      baseId: v.string().describe(
        'The ID of the Airtable base (starts with "app")',
      ),
      tableIdOrName: v.string().describe("The ID or name of the table"),
      recordId: v.string().describe(
        'The ID of the record to update (starts with "rec")',
      ),
      fields: v
        .record(v.string(), v.unknown())
        .describe(
          'Field values to update. Field names must match exactly. Example: { "Status": "Done" }',
        ),
      typecast: v.boolean().optional().describe(
        "Allow Airtable to typecast field values",
      ),
    })
  )(),
  async execute(
    { baseId, tableIdOrName, recordId, fields, typecast },
    context,
  ) {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    const record = await client.updateRecord(
      baseId,
      tableIdOrName,
      recordId,
      fields,
      {
        typecast,
      },
    );

    return {
      id: record.id,
      createdTime: record.createdTime,
      fields: record.fields,
    };
  },
});
