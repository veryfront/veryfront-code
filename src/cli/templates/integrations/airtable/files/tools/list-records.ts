import { tool } from "veryfront/tool";
import { z } from "zod";
import { listRecords } from "../../lib/airtable-client.ts";

export default tool({
  id: "list-records",
  description:
    "List records from an Airtable table. Supports filtering with formulas, sorting, and limiting results. Returns record IDs, creation times, and all field values.",
  inputSchema: z.object({
    baseId: z.string().describe('The ID of the Airtable base (starts with "app")'),
    tableIdOrName: z.string().describe("The ID or name of the table"),
    fields: z
      .array(z.string())
      .optional()
      .describe("Specific field names to return (returns all fields if not specified)"),
    filterByFormula: z
      .string()
      .optional()
      .describe('Airtable formula to filter records (e.g., "{Status} = \'Done\'")'),
    maxRecords: z.number().min(1).max(100).optional().describe("Maximum number of records to return"),
    sort: z
      .array(
        z.object({
          field: z.string().describe("Field name to sort by"),
          direction: z.enum(["asc", "desc"]).describe("Sort direction"),
        }),
      )
      .optional()
      .describe("Array of sort specifications"),
    view: z.string().optional().describe("Name of a view to use for filtering and sorting"),
  }),
  async execute({ baseId, tableIdOrName, fields, filterByFormula, maxRecords, sort, view }) {
    const { records, offset } = await listRecords(baseId, tableIdOrName, {
      fields,
      filterByFormula,
      maxRecords,
      pageSize: maxRecords,
      sort,
      view,
    });

    return {
      records: records.map(({ id, createdTime, fields }) => ({ id, createdTime, fields })),
      count: records.length,
      hasMore: Boolean(offset),
    };
  },
});
