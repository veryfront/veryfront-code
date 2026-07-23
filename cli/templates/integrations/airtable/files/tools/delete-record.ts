import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "delete-record",
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
  execute: async ({ baseId, tableIdOrName, recordId }, context) => {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    return await client.deleteRecord(baseId, tableIdOrName, recordId);
  },
});
