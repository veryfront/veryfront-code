import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "create-chart",
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
  execute({ spreadsheetId, chart }) {
    return createSheetsClient(DEFAULT_USER_ID).createChart(
      spreadsheetId,
      chart,
    );
  },
});
