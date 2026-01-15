import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  description: "Validate data structure and quality - checks for nulls, types, and issues",
  inputSchema: z.object({
    data: z.unknown().describe("The data to validate (object, array, or primitive)"),
    rules: z.object({
      requireFields: z.array(z.string()).optional().describe("Fields that must exist"),
      maxNulls: z.number().optional().describe("Maximum allowed null values"),
      allowEmpty: z.boolean().optional().default(false).describe("Allow empty arrays/objects"),
    }).optional(),
  }),
  execute: async ({ data, rules = {} }) => {
    const issues: string[] = [];
    const warnings: string[] = [];
    let nullCount = 0;
    let fieldCount = 0;

    function validate(obj: unknown, path = ""): void {
      if (obj === null || obj === undefined) {
        nullCount++;
        issues.push(`Null value at ${path || "root"}`);
        return;
      }

      if (Array.isArray(obj)) {
        if (obj.length === 0 && !rules.allowEmpty) {
          warnings.push(`Empty array at ${path || "root"}`);
        }
        obj.forEach((item, i) => validate(item, `${path}[${i}]`));
      } else if (typeof obj === "object") {
        const keys = Object.keys(obj as object);
        if (keys.length === 0 && !rules.allowEmpty) {
          warnings.push(`Empty object at ${path || "root"}`);
        }
        for (const key of keys) {
          fieldCount++;
          validate((obj as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
        }
      }
    }

    validate(data);

    // Check required fields
    if (rules.requireFields && typeof data === "object" && data !== null) {
      for (const field of rules.requireFields) {
        if (!(field in (data as object))) {
          issues.push(`Missing required field: ${field}`);
        }
      }
    }

    // Check max nulls
    if (rules.maxNulls !== undefined && nullCount > rules.maxNulls) {
      issues.push(`Too many null values: ${nullCount} (max: ${rules.maxNulls})`);
    }

    const valid = issues.length === 0;

    return {
      valid,
      validatedAt: new Date().toISOString(),
      stats: { fieldCount, nullCount },
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
});
