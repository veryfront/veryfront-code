import { tool } from "veryfront/tool";
import { z } from "zod";
import { getRecord } from "../../lib/airtable-client.ts";

export default tool({
  id: "get-record",
  description:
    "Get a specific record from an Airtable table by its ID. Returns the full record with all field values.",
  inputSchema: z.object({
    baseId: z.string().describe('The ID of the Airtable base (starts with "app")'),
    tableIdOrName: z.string().describe("The ID or name of the table"),
    recordId: z.string().describe('The ID of the record to retrieve (starts with "rec")'),
  }),
  async execute({ baseId, tableIdOrName, recordId }) {
    const record = await getRecord(baseId, tableIdOrName, recordId);

    return {
      id: record.id,
      createdTime: record.createdTime,
      fields: record.fields,
    };
  },
});
