import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "clear-range",
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
  execute({ spreadsheetId, range }) {
    return createSheetsClient(DEFAULT_USER_ID).clearRange(spreadsheetId, range);
  },
});
