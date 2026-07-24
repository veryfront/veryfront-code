import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "sheets-clear-range",
  description:
    "Clear cell values from a Google Sheets range while preserving formatting.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      range: v.string().describe(
        "A1 notation range to clear (e.g., 'Sheet1!A2:D100')",
      ),
    })
  )(),
  execute({ spreadsheetId, range }, context) {
    const userId = requireUserIdFromContext(context);
    return createSheetsClient(userId).clearRange(spreadsheetId, range);
  },
});
