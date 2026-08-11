import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "sheets-add-sheet",
  description: "Add a new sheet/tab to an existing spreadsheet.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      title: v.string().describe("Title for the new sheet/tab"),
      rowCount: v.number().min(1).max(10000).optional(),
      columnCount: v.number().min(1).max(18278).optional(),
    })
  )(),
  execute({ spreadsheetId, title, rowCount, columnCount }, context) {
    const userId = requireUserIdFromContext(context);
    return createSheetsClient(userId).addSheet(spreadsheetId, title, {
      rowCount,
      columnCount,
    });
  },
});
