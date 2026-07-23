import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "create-spreadsheet",
  description:
    "Create a new Google Sheets spreadsheet with optional sheet configurations. Returns the new spreadsheet ID and URL.",
  inputSchema: defineSchema((v) =>
    v.object({
      title: v.string().describe("Title of the new spreadsheet"),
      sheets: v
        .array(
          v.object({
            title: v.string().describe("Name of the sheet/tab"),
            rowCount: v
              .number()
              .min(1)
              .max(10000)
              .optional()
              .describe("Number of rows (default: 1000)"),
            columnCount: v
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
      initialData: v
        .object({
          sheetTitle: v.string().describe("Name of the sheet to write data to"),
          range: v
            .string()
            .describe("Range in A1 notation (e.g., 'A1', 'A1:D10')"),
          values: v
            .array(v.array(v.any()))
            .describe(
              "2D array of values to write. Example: [['Name', 'Age'], ['John', 30]]",
            ),
        })
        .optional()
        .describe("Optional initial data to populate the spreadsheet"),
    })
  )(),
  async execute({ title, sheets, initialData }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createSheetsClient(userId);
    const spreadsheet = await client.createSpreadsheet({ title, sheets });

    if (!initialData) {
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
    }

    await client.writeRange({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: `${initialData.sheetTitle}!${initialData.range}`,
      values: initialData.values,
      valueInputOption: "USER_ENTERED",
    });

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
