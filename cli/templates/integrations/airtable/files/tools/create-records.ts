import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "airtable-create-records",
  description:
    "Create multiple records in an Airtable table. Provide an array of record objects with field values. Returns created records with IDs.",
  inputSchema: defineSchema((v) =>
    v.object({
      baseId: v.string().describe(
        'The ID of the Airtable base (starts with "app")',
      ),
      tableIdOrName: v.string().describe("The ID or name of the table"),
      records: v
        .array(v.object({ fields: v.record(v.string(), v.unknown()) }))
        .min(1)
        .max(10)
        .describe(
          'Array of 1-10 records to create. Example: [{ fields: { "Name": "Jane" } }]',
        ),
      typecast: v.boolean().optional().describe(
        "Allow Airtable to typecast field values",
      ),
    })
  )(),
  async execute({ baseId, tableIdOrName, records, typecast }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    const createdRecords = await client.createRecords(
      baseId,
      tableIdOrName,
      records,
      {
        typecast,
      },
    );

    return createdRecords.map((record) => ({
      id: record.id,
      createdTime: record.createdTime,
      fields: record.fields,
    }));
  },
});
