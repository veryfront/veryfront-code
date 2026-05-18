import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "batch-update",
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
  ) {
    return createSheetsClient(DEFAULT_USER_ID).batchUpdate({
      spreadsheetId,
      requests,
      includeSpreadsheetInResponse,
      responseRanges,
    });
  },
});
