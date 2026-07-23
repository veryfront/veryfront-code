import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createSheetsClient } from "../lib/sheets-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "find-replace",
  description:
    "Find and replace text in a spreadsheet, optionally limited to a single sheet ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      spreadsheetId: v.string().describe("The ID of the spreadsheet"),
      find: v.string().describe("Text or regex pattern to find"),
      replacement: v.string().describe("Replacement text"),
      sheetId: v.number().optional().describe(
        "Optional numeric sheet ID to limit replacement",
      ),
      matchCase: v.boolean().optional(),
      matchEntireCell: v.boolean().optional(),
      searchByRegex: v.boolean().optional(),
    })
  )(),
  execute(
    {
      spreadsheetId,
      find,
      replacement,
      sheetId,
      matchCase,
      matchEntireCell,
      searchByRegex,
    },
    context,
  ) {
    const userId = requireUserIdFromContext(context);
    return createSheetsClient(userId).findReplace({
      spreadsheetId,
      find,
      replacement,
      sheetId,
      matchCase,
      matchEntireCell,
      searchByRegex,
    });
  },
});
