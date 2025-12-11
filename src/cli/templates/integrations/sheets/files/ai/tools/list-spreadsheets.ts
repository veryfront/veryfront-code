import { tool } from "veryfront/ai";
import { z } from "zod";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "list-spreadsheets",
  description:
    "List recent Google Sheets spreadsheets from Google Drive. Returns spreadsheet names, IDs, and metadata.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of spreadsheets to return"),
    orderBy: z
      .enum(["createdTime", "modifiedTime", "name"])
      .default("modifiedTime")
      .describe("Sort order for results"),
  }),
  async execute({ maxResults, orderBy }) {
    const client = createSheetsClient(DEFAULT_USER_ID);

    const spreadsheets = await client.listSpreadsheets({
      maxResults,
      orderBy,
    });

    return spreadsheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      url: sheet.webViewLink,
      createdTime: sheet.createdTime,
      modifiedTime: sheet.modifiedTime,
    }));
  },
});
