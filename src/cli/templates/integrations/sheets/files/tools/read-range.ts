import { tool } from "veryfront/tool";
import { z } from "zod";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "read-range",
  description:
    "Read cell data from a Google Sheets range. Returns a 2D array of values. Use A1 notation (e.g., 'Sheet1!A1:D10', 'A1:B', or just 'Sheet1' for entire sheet).",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("The ID of the spreadsheet"),
    range: z
      .string()
      .describe(
        "Range in A1 notation (e.g., 'Sheet1!A1:D10', 'A1:B5', or 'Sheet1' for entire sheet)",
      ),
  }),
  async execute({ spreadsheetId, range }) {
    const client = createSheetsClient(DEFAULT_USER_ID);
    const result = await client.readRange(spreadsheetId, range);

    return {
      range: result.range,
      values: result.values,
      rowCount: result.values.length,
      columnCount: result.values[0]?.length ?? 0,
    };
  },
});
