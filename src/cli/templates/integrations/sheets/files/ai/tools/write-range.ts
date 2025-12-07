import { tool } from "veryfront/ai";
import { z } from "zod";
import { createSheetsClient } from "../../lib/sheets-client.ts";

// Default user ID for demo/dev purposes
// In production, get from authenticated session
const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "write-range",
  description:
    "Write data to a Google Sheets range. Overwrites existing content in the specified range. Provide data as a 2D array where each inner array is a row.",
  inputSchema: z.object({
    spreadsheetId: z
      .string()
      .describe("The ID of the spreadsheet"),
    range: z
      .string()
      .describe(
        "Range in A1 notation where to write data (e.g., 'Sheet1!A1', 'Sheet1!A1:D5')",
      ),
    values: z
      .array(z.array(z.any()))
      .describe(
        "2D array of values to write. Each inner array represents a row. Example: [['Name', 'Age'], ['John', 30], ['Jane', 25]]",
      ),
    valueInputOption: z
      .enum(["RAW", "USER_ENTERED"])
      .default("USER_ENTERED")
      .describe(
        "RAW: Values are stored as-is. USER_ENTERED: Values are parsed as if typed by user (formulas, numbers, dates)",
      ),
  }),
  async execute({ spreadsheetId, range, values, valueInputOption }) {
    const client = createSheetsClient(DEFAULT_USER_ID);

    const result = await client.writeRange({
      spreadsheetId,
      range,
      values,
      valueInputOption,
    });

    return {
      updatedRange: result.updatedRange,
      updatedRows: result.updatedRows,
      updatedColumns: result.updatedColumns,
      updatedCells: result.updatedCells,
    };
  },
});
