import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "set-data-validation",
  description: "Set a Google Sheets data validation rule on a grid range.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      range: v.record(v.string(), v.any()).describe(
        "Google Sheets API GridRange",
      ),
      rule: v.record(v.string(), v.any()).describe(
        "Google Sheets API DataValidationRule",
      ),
    })
  )(),
  execute({ spreadsheetId, range, rule }, context) {
    const userId = requireUserIdFromContext(context);
    return createSheetsClient(userId).setDataValidation({
      spreadsheetId,
      range,
      rule,
    });
  },
});
