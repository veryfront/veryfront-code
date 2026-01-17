import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  description: "Enrich data by adding computed fields, timestamps, or lookups",
  inputSchema: z.object({
    data: z.unknown().describe("Data to enrich (object or array of objects)"),
    enrichments: z.object({
      addTimestamp: z.boolean().optional().describe("Add current timestamp field"),
      addId: z.boolean().optional().describe("Add unique ID to each record"),
      lookup: z.record(z.record(z.unknown())).optional().describe("Lookup table: field -> {value -> enrichment}"),
      compute: z.record(z.string()).optional().describe("Computed fields using simple expressions"),
    }).optional(),
  }),
  execute: async ({ data, enrichments = {} }) => {
    let idCounter = 1;

    const enrichRecord = (record: Record<string, unknown>): Record<string, unknown> => {
      const result = { ...record };

      // Add timestamp
      if (enrichments.addTimestamp) {
        result._enrichedAt = new Date().toISOString();
      }

      // Add unique ID
      if (enrichments.addId) {
        result._id = `rec_${Date.now()}_${idCounter++}`;
      }

      // Apply lookups
      if (enrichments.lookup) {
        for (const [field, lookupTable] of Object.entries(enrichments.lookup)) {
          const value = String(record[field] ?? "");
          if (lookupTable[value]) {
            Object.assign(result, lookupTable[value]);
          }
        }
      }

      // Apply computed fields (simple string concatenation/templates)
      if (enrichments.compute) {
        for (const [newField, expression] of Object.entries(enrichments.compute)) {
          // Simple template replacement: {{fieldName}}
          result[newField] = expression.replace(/\{\{(\w+)\}\}/g, (_, key) =>
            String(record[key] ?? "")
          );
        }
      }

      return result;
    };

    let enriched: unknown;
    let recordCount = 0;

    if (Array.isArray(data)) {
      enriched = data.map((item) => {
        if (typeof item === "object" && item !== null) {
          recordCount++;
          return enrichRecord(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (typeof data === "object" && data !== null) {
      enriched = enrichRecord(data as Record<string, unknown>);
      recordCount = 1;
    } else {
      enriched = data;
    }

    return {
      success: true,
      enrichedAt: new Date().toISOString(),
      recordsEnriched: recordCount,
      result: enriched,
    };
  },
});
