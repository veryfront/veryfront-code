import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "copy-sheet",
  description: "Copy a sheet/tab to another spreadsheet.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("Source spreadsheet ID"),
      sheetId: v.number().describe("Numeric source sheet ID"),
      destinationSpreadsheetId: v.string().describe(
        "Destination spreadsheet ID",
      ),
    })
  )(),
  execute({ spreadsheetId, sheetId, destinationSpreadsheetId }) {
    return createSheetsClient(DEFAULT_USER_ID).copySheet({
      spreadsheetId,
      sheetId,
      destinationSpreadsheetId,
    });
  },
});
