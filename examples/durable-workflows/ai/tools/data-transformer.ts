import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  description: "Transform data - rename fields, filter, map values",
  inputSchema: z.object({
    data: z.unknown().describe("The data to transform (array of objects or single object)"),
    operations: z.object({
      renameFields: z.record(z.string()).optional().describe("Map of oldName -> newName"),
      selectFields: z.array(z.string()).optional().describe("Only include these fields"),
      excludeFields: z.array(z.string()).optional().describe("Exclude these fields"),
      addFields: z.record(z.unknown()).optional().describe("Add new fields with static values"),
    }).optional(),
  }),
  execute: async ({ data, operations = {} }) => {
    const transformRecord = (record: Record<string, unknown>): Record<string, unknown> => {
      let result = { ...record };

      // Rename fields
      if (operations.renameFields) {
        for (const [oldName, newName] of Object.entries(operations.renameFields)) {
          if (oldName in result) {
            result[newName] = result[oldName];
            delete result[oldName];
          }
        }
      }

      // Select only specific fields
      if (operations.selectFields) {
        const selected: Record<string, unknown> = {};
        for (const field of operations.selectFields) {
          if (field in result) {
            selected[field] = result[field];
          }
        }
        result = selected;
      }

      // Exclude fields
      if (operations.excludeFields) {
        for (const field of operations.excludeFields) {
          delete result[field];
        }
      }

      // Add new fields
      if (operations.addFields) {
        result = { ...result, ...operations.addFields };
      }

      return result;
    };

    let transformed: unknown;
    let recordCount = 0;

    if (Array.isArray(data)) {
      transformed = data.map((item) => {
        if (typeof item === "object" && item !== null) {
          recordCount++;
          return transformRecord(item as Record<string, unknown>);
        }
        return item;
      });
      recordCount = data.length;
    } else if (typeof data === "object" && data !== null) {
      transformed = transformRecord(data as Record<string, unknown>);
      recordCount = 1;
    } else {
      transformed = data;
    }

    return {
      success: true,
      transformedAt: new Date().toISOString(),
      recordsProcessed: recordCount,
      result: transformed,
    };
  },
});
