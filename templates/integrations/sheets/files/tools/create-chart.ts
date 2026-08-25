import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "sheets-create-chart",
  description:
    "Create an embedded chart. Provide a Google Sheets API EmbeddedChart spec without chartId.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      chart: v.record(v.string(), v.any()).describe(
        "Google Sheets API EmbeddedChart spec",
      ),
    })
  )(),
  execute({ spreadsheetId, chart }, context) {
    const userId = requireUserIdFromContext(context);
    return createSheetsClient(userId).createChart(
      spreadsheetId,
      chart,
    );
  },
});
