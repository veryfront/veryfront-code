import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  description: "Aggregate numeric data - calculate sum, average, min, max, count",
  inputSchema: z.object({
    data: z.array(z.unknown()).describe("Array of objects or numbers to aggregate"),
    field: z.string().optional().describe("Field name to aggregate (for array of objects)"),
    groupBy: z.string().optional().describe("Field to group by before aggregating"),
  }),
  execute: async ({ data, field, groupBy }) => {
    const extractNumber = (item: unknown): number | null => {
      if (typeof item === "number") return item;
      if (field && typeof item === "object" && item !== null) {
        const value = (item as Record<string, unknown>)[field];
        if (typeof value === "number") return value;
        if (typeof value === "string") {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) return parsed;
        }
      }
      return null;
    };

    const calculateStats = (numbers: number[]) => {
      if (numbers.length === 0) {
        return { count: 0, sum: 0, average: 0, min: 0, max: 0 };
      }
      const sum = numbers.reduce((a, b) => a + b, 0);
      const avg = sum / numbers.length;
      return {
        count: numbers.length,
        sum: Math.round(sum * 100) / 100,
        average: Math.round(avg * 100) / 100,
        min: Math.round(Math.min(...numbers) * 100) / 100,
        max: Math.round(Math.max(...numbers) * 100) / 100,
      };
    };

    if (groupBy) {
      // Group data and calculate stats per group
      const groups = new Map<string, number[]>();
      for (const item of data) {
        if (typeof item === "object" && item !== null) {
          const groupKey = String((item as Record<string, unknown>)[groupBy] ?? "undefined");
          const num = extractNumber(item);
          if (num !== null) {
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey)!.push(num);
          }
        }
      }
      const groupedResults: Record<string, ReturnType<typeof calculateStats>> = {};
      for (const [key, numbers] of groups) {
        groupedResults[key] = calculateStats(numbers);
      }
      return {
        success: true,
        aggregatedAt: new Date().toISOString(),
        groupedBy: groupBy,
        groups: groupedResults,
      };
    }

    // Simple aggregation
    const numbers = data.map(extractNumber).filter((n): n is number => n !== null);
    return {
      success: true,
      aggregatedAt: new Date().toISOString(),
      statistics: calculateStats(numbers),
    };
  },
});
