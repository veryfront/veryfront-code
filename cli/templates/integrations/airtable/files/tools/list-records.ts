import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listRecords } from "../../lib/airtable-client.ts";

export default tool({
  id: "list-records",
  description:
    "List records from an Airtable table. Supports filtering with formulas, sorting, and limiting results. Returns record IDs, creation times, and all field values.",
  inputSchema: defineSchema((v) => v.object({
    baseId: v.string().describe('The ID of the Airtable base (starts with "app")'),
    tableIdOrName: v.string().describe("The ID or name of the table"),
    fields: v
      .array(v.string())
      .optional()
      .describe("Specific field names to return (returns all fields if not specified)"),
    filterByFormula: v
      .string()
      .optional()
      .describe('Airtable formula to filter records (e.g., "{Status} = \'Done\'")'),
    maxRecords: v.number().min(1).max(100).optional().describe("Maximum number of records to return"),
    sort: v
      .array(
        v.object({
          field: v.string().describe("Field name to sort by"),
          direction: v.enum(["asc", "desc"]).describe("Sort direction"),
        }),
      )
      .optional()
      .describe("Array of sort specifications"),
    view: v.string().optional().describe("Name of a view to use for filtering and sorting"),
  }))(),
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
      records: records.map((record) => ({
        id: record.id,
        createdTime: record.createdTime,
        fields: record.fields,
      })),
      count: records.length,
      hasMore: Boolean(offset),
    };
  },
});
