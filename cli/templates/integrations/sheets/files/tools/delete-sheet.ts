import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "delete-sheet",
  description: "Delete a sheet/tab from a spreadsheet by numeric sheet ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      sheetId: v.number().describe(
        "Numeric sheet ID to delete, from get-spreadsheet",
      ),
    })
  )(),
  execute({ spreadsheetId, sheetId }) {
    return createSheetsClient(DEFAULT_USER_ID).deleteSheet(
      spreadsheetId,
      sheetId,
    );
  },
});
