import { tool } from "veryfront/tool";
import { z } from "zod";
import { createSheetsClient } from "../../lib/sheets-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "create-spreadsheet",
  description:
    "Create a new Google Sheets spreadsheet with optional sheet configurations. Returns the new spreadsheet ID and URL.",
  inputSchema: z.object({
    title: z.string().describe("Title of the new spreadsheet"),
    sheets: z
      .array(
        z.object({
          title: z.string().describe("Name of the sheet/tab"),
          rowCount: z
            .number()
            .min(1)
            .max(10000)
            .optional()
            .describe("Number of rows (default: 1000)"),
          columnCount: z
            .number()
            .min(1)
            .max(26)
            .optional()
            .describe("Number of columns (default: 26)"),
        }),
      )
      .optional()
      .describe(
        "Optional array of sheet configurations. If not provided, a single default sheet is created.",
      ),
    initialData: z
      .object({
        sheetTitle: z.string().describe("Name of the sheet to write data to"),
        range: z
          .string()
          .describe("Range in A1 notation (e.g., 'A1', 'A1:D10')"),
        values: z
          .array(z.array(z.any()))
          .describe(
            "2D array of values to write. Example: [['Name', 'Age'], ['John', 30]]",
          ),
      })
      .optional()
      .describe("Optional initial data to populate the spreadsheet"),
  }),
  async execute({ title, sheets, initialData }) {
    const client = createSheetsClient(DEFAULT_USER_ID);

    const spreadsheet = await client.createSpreadsheet({ title, sheets });

    if (initialData) {
      await client.writeRange({
        spreadsheetId: spreadsheet.spreadsheetId,
        range: `${initialData.sheetTitle}!${initialData.range}`,
        values: initialData.values,
        valueInputOption: "USER_ENTERED",
      });
    }

    return {
      id: spreadsheet.spreadsheetId,
      title: spreadsheet.properties.title,
      url: spreadsheet.spreadsheetUrl,
      sheets: spreadsheet.sheets.map(({ properties }) => ({
        id: properties.sheetId,
        title: properties.title,
        index: properties.index,
      })),
    };
  },
});
