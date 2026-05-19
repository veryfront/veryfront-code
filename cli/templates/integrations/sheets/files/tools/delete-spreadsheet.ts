import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "delete-spreadsheet",
  description:
    "Delete an app-accessible spreadsheet file. Defaults to moving it to trash for safer cleanup.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The spreadsheet/Drive file ID"),
      permanentlyDelete: v.boolean().default(false).describe(
        "If true, permanently deletes instead of moving to trash",
      ),
    })
  )(),
  execute({ spreadsheetId, permanentlyDelete }) {
    return createSheetsClient(DEFAULT_USER_ID).deleteSpreadsheet(
      spreadsheetId,
      { permanentlyDelete },
    );
  },
});
