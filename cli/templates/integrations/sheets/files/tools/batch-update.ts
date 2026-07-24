import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "sheets-batch-update",
  description:
    "Run Google Sheets batchUpdate requests for formatting, filters, dimensions, protected ranges, charts, and other advanced spreadsheet changes.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      requests: v.array(v.record(v.string(), v.any())).describe(
        "Google Sheets API batchUpdate requests",
      ),
      includeSpreadsheetInResponse: v.boolean().optional(),
      responseRanges: v.array(v.string()).optional(),
    })
  )(),
  execute(
    { spreadsheetId, requests, includeSpreadsheetInResponse, responseRanges },
    context,
  ) {
    const userId = requireUserIdFromContext(context);
    return createSheetsClient(userId).batchUpdate({
      spreadsheetId,
      requests,
      includeSpreadsheetInResponse,
      responseRanges,
    });
  },
});
