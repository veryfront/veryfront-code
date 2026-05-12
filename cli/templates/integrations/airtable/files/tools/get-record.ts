import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getRecord } from "../../lib/airtable-client.ts";

export default tool({
  id: "get-record",
  description:
    "Get a specific record from an Airtable table by its ID. Returns the full record with all field values.",
  inputSchema: defineSchema((v) => v.object({
    baseId: v.string().describe('The ID of the Airtable base (starts with "app")'),
    tableIdOrName: v.string().describe("The ID or name of the table"),
    recordId: v.string().describe('The ID of the record to retrieve (starts with "rec")'),
  }))(),
  execute: async ({ baseId, tableIdOrName, recordId }) =>
    getRecord(baseId, tableIdOrName, recordId),
});
