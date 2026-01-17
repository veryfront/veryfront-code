import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  description: "Export data to JSON or CSV format - returns formatted string",
  inputSchema: z.object({
    data: z.unknown().describe("Data to export"),
    format: z.enum(["json", "csv"]).default("json").describe("Output format"),
    pretty: z.boolean().optional().default(true).describe("Pretty print JSON"),
  }),
  execute: async ({ data, format, pretty = true }) => {
    let output: string;
    let mimeType: string;

    if (format === "csv") {
      // Convert to CSV
      const rows: string[][] = [];

      if (Array.isArray(data) && data.length > 0) {
        // Get headers from first object
        const firstItem = data[0];
        if (typeof firstItem === "object" && firstItem !== null) {
          const headers = Object.keys(firstItem as object);
          rows.push(headers);

          // Add data rows
          for (const item of data) {
            if (typeof item === "object" && item !== null) {
              const row = headers.map((h) => {
                const value = (item as Record<string, unknown>)[h];
                const str = value === null || value === undefined ? "" : String(value);
                // Escape quotes and wrap in quotes if contains comma/newline
                if (str.includes(",") || str.includes("\n") || str.includes('"')) {
                  return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
              });
              rows.push(row);
            }
          }
        }
      }

      output = rows.map((row) => row.join(",")).join("\n");
      mimeType = "text/csv";
    } else {
      // JSON format
      output = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
      mimeType = "application/json";
    }

    return {
      success: true,
      exportedAt: new Date().toISOString(),
      format,
      mimeType,
      sizeBytes: new TextEncoder().encode(output).length,
      content: output,
    };
  },
});
