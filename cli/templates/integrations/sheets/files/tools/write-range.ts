import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

const VALUE_INPUT_OPTIONS = ["RAW", "USER_ENTERED"] as const;

export default tool({
  id: "write-range",
  description:
    "Write data to a Google Sheets range. Overwrites existing content in the specified range. Provide data as a 2D array where each inner array is a row.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      range: v
        .string()
        .describe(
          "Range in A1 notation where to write data (e.g., 'Sheet1!A1', 'Sheet1!A1:D5')",
        ),
      values: v
        .array(v.array(v.any()))
        .describe(
          "2D array of values to write. Each inner array represents a row. Example: [['Name', 'Age'], ['John', 30], ['Jane', 25]]",
        ),
      valueInputOption: v
        .enum(["RAW", "USER_ENTERED"])
        .default("USER_ENTERED")
        .describe(
          "RAW: Values are stored as-is. USER_ENTERED: Values are parsed as if typed by user (formulas, numbers, dates)",
        ),
    })
  )(),
  execute({ spreadsheetId, range, values, valueInputOption }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createSheetsClient(userId);
    return client.writeRange({
      spreadsheetId,
      range,
      values,
      valueInputOption: requireAllowedValue(
        valueInputOption,
        VALUE_INPUT_OPTIONS,
        "valueInputOption",
      ),
    });
  },
});
