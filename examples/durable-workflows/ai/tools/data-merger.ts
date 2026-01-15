import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  description: "Merge multiple data arrays or objects together",
  inputSchema: z.object({
    datasets: z.array(z.unknown()).describe("Array of datasets to merge"),
    strategy: z.enum(["concat", "deep_merge", "zip"]).optional().default("concat").describe("Merge strategy"),
    key: z.string().optional().describe("Key field for joining (for zip strategy)"),
  }),
  execute: async ({ datasets, strategy = "concat", key }) => {
    if (datasets.length === 0) {
      return { success: true, mergedAt: new Date().toISOString(), result: [] };
    }

    let result: unknown;

    switch (strategy) {
      case "concat": {
        // Concatenate arrays, or merge objects
        const arrays = datasets.filter(Array.isArray);
        if (arrays.length > 0) {
          result = arrays.flat();
        } else {
          result = datasets.reduce((acc, item) => {
            if (typeof item === "object" && item !== null) {
              return { ...(acc as object), ...(item as object) };
            }
            return acc;
          }, {});
        }
        break;
      }
      case "deep_merge": {
        // Deep merge objects
        const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
          const output = { ...target };
          for (const key of Object.keys(source)) {
            if (typeof source[key] === "object" && source[key] !== null && !Array.isArray(source[key])) {
              output[key] = deepMerge(
                (output[key] as Record<string, unknown>) || {},
                source[key] as Record<string, unknown>
              );
            } else {
              output[key] = source[key];
            }
          }
          return output;
        };
        result = datasets.reduce((acc, item) => {
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            return deepMerge(acc as Record<string, unknown>, item as Record<string, unknown>);
          }
          return acc;
        }, {});
        break;
      }
      case "zip": {
        // Join arrays by key
        if (!key) {
          return { success: false, error: "Key field required for zip strategy" };
        }
        const map = new Map<string, Record<string, unknown>>();
        for (const dataset of datasets) {
          if (Array.isArray(dataset)) {
            for (const item of dataset) {
              if (typeof item === "object" && item !== null) {
                const keyValue = String((item as Record<string, unknown>)[key]);
                const existing = map.get(keyValue) || {};
                map.set(keyValue, { ...existing, ...(item as Record<string, unknown>) });
              }
            }
          }
        }
        result = Array.from(map.values());
        break;
      }
    }

    return {
      success: true,
      mergedAt: new Date().toISOString(),
      strategy,
      inputCount: datasets.length,
      result,
    };
  },
});
