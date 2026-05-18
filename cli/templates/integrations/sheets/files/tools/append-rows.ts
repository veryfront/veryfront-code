import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "append-rows",
  description:
    "Append rows to a Google Sheets range. Use for trackers, logs, and adding records without overwriting existing rows.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      range: v.string().describe(
        "A1 notation range/table to append to (e.g., 'Sheet1!A:C')",
      ),
      values: v.array(v.array(v.any())).describe("2D array of rows to append"),
      valueInputOption: v.enum(["RAW", "USER_ENTERED"]).default("USER_ENTERED"),
      insertDataOption: v.enum(["OVERWRITE", "INSERT_ROWS"]).default(
        "INSERT_ROWS",
      ),
    })
  )(),
  execute(
    { spreadsheetId, range, values, valueInputOption, insertDataOption },
  ) {
    return createSheetsClient(DEFAULT_USER_ID).appendRange({
      spreadsheetId,
      range,
      values,
      valueInputOption,
      insertDataOption,
    });
  },
});
