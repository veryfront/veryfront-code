import { tool } from "veryfront/tool";
import { z } from "zod";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "get-spreadsheet",
  description:
    "Get metadata about a Google Sheets spreadsheet including all sheet names, properties, and structure. Use this to discover available sheets and their dimensions.",
  inputSchema: z.object({
    spreadsheetId: z
      .string()
      .describe("The ID of the spreadsheet (from URL or list-spreadsheets)"),
  }),
  async execute({ spreadsheetId }) {
    const client = createSheetsClient(DEFAULT_USER_ID);
    const spreadsheet = await client.getSpreadsheet(spreadsheetId);

    return {
      id: spreadsheet.spreadsheetId,
      title: spreadsheet.properties.title,
      url: spreadsheet.spreadsheetUrl,
      locale: spreadsheet.properties.locale,
      timeZone: spreadsheet.properties.timeZone,
      sheets: spreadsheet.sheets.map(({ properties }) => ({
        id: properties.sheetId,
        title: properties.title,
        index: properties.index,
        type: properties.sheetType,
        rowCount: properties.gridProperties?.rowCount,
        columnCount: properties.gridProperties?.columnCount,
      })),
    };
  },
});
