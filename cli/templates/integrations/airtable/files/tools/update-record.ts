import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { updateRecord } from "../../lib/airtable-client.ts";

export default tool({
  id: "update-record",
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
  async execute({ baseId, tableIdOrName, recordId, fields, typecast }) {
    const record = await updateRecord(baseId, tableIdOrName, recordId, fields, {
      typecast,
    });

    return {
      id: record.id,
      createdTime: record.createdTime,
      fields: record.fields,
    };
  },
});
