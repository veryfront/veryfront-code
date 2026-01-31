import { tool } from "veryfront/tool";
import { z } from "zod";
import { createRecord } from "../../lib/airtable-client.ts";

export default tool({
  id: "create-record",
  description:
    "Create a new record in an Airtable table. Provide field names and values as an object. Returns the created record with its ID.",
  inputSchema: z.object({
    baseId: z.string().describe('The ID of the Airtable base (starts with "app")'),
    tableIdOrName: z.string().describe("The ID or name of the table"),
    fields: z
      .record(z.unknown())
      .describe(
        'Object with field names as keys and their values. Field names must match exactly. Example: { "Name": "John Doe", "Email": "john@example.com", "Status": "Active" }',
      ),
  }),
  async execute({ baseId, tableIdOrName, fields }) {
    const record = await createRecord(baseId, tableIdOrName, fields);

    return { id: record.id, createdTime: record.createdTime, fields: record.fields };
  },
});
