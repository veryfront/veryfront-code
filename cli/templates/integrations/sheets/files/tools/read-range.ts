import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "sheets-read-range",
  description:
    "Read cell data from a Google Sheets range. Returns a 2D array of values. Use A1 notation (e.g., 'Sheet1!A1:D10', 'A1:B', or just 'Sheet1' for entire sheet).",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      range: v
        .string()
        .describe(
          "Range in A1 notation (e.g., 'Sheet1!A1:D10', 'A1:B5', or 'Sheet1' for entire sheet)",
        ),
    })
  )(),
  async execute({ spreadsheetId, range }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createSheetsClient(userId);
    const { range: resultRange, values } = await client.readRange(
      spreadsheetId,
      range,
    );

    return {
      range: resultRange,
      values,
      rowCount: values.length,
      columnCount: values[0]?.length ?? 0,
    };
  },
});
