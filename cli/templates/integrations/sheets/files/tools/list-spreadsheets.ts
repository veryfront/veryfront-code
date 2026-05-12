import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "list-spreadsheets",
  description:
    "List recent Google Sheets spreadsheets from Google Drive. Returns spreadsheet names, IDs, and metadata.",
  inputSchema: defineSchema((v) => v.object({
    maxResults: v
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of spreadsheets to return"),
    orderBy: v
      .enum(["createdTime", "modifiedTime", "name"])
      .default("modifiedTime")
      .describe("Sort order for results"),
  }))(),
  async execute({ maxResults, orderBy }) {
    const client = createSheetsClient(DEFAULT_USER_ID);
    const spreadsheets = await client.listSpreadsheets({ maxResults, orderBy });

    return spreadsheets.map((spreadsheet) => ({
      id: spreadsheet.id,
      name: spreadsheet.name,
      url: spreadsheet.webViewLink,
      createdTime: spreadsheet.createdTime,
      modifiedTime: spreadsheet.modifiedTime,
    }));
  },
});
