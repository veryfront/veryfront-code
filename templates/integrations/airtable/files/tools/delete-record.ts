import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { deleteRecord } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "airtable-delete-record",
  description:
    "Delete an Airtable record from a table. Returns Airtable's deletion confirmation.",
  inputSchema: defineSchema((v) =>
    v.object({
      baseId: v.string().describe(
        'The ID of the Airtable base (starts with "app")',
      ),
      tableIdOrName: v.string().describe("The ID or name of the table"),
      recordId: v.string().describe(
        'The ID of the record to delete (starts with "rec")',
      ),
    })
  )(),
  execute: async ({ baseId, tableIdOrName, recordId }, context) =>
    deleteRecord(requireUserIdFromContext(context), baseId, tableIdOrName, recordId),
});
