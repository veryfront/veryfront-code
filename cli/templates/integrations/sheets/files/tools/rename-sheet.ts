import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "rename-sheet",
  description: "Rename an existing sheet/tab by numeric sheet ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      sheetId: v.number().describe("Numeric sheet ID to rename"),
      title: v.string().describe("New sheet/tab title"),
    })
  )(),
  execute({ spreadsheetId, sheetId, title }) {
    return createSheetsClient(DEFAULT_USER_ID).renameSheet(
      spreadsheetId,
      sheetId,
      title,
    );
  },
});
