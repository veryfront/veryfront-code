import { rendererLogger as logger } from "@veryfront/utils";

export interface FrontmatterExtractionResult {
  body: string;
  frontmatter: Record<string, unknown>;
}

async function extractYamlFrontmatter(content: string): Promise<FrontmatterExtractionResult> {
  if (!content.trim().startsWith("---")) {
    return { body: content, frontmatter: {} };
  }

  const { extract } = await import("std/front_matter/yaml.ts");
  const extracted = extract(content);
  return {
    body: extracted.body,
    frontmatter: extracted.attrs as Record<string, unknown>,
  };
}

function extractExportConstants(body: string): { body: string; exports: Record<string, unknown> } {
  const exportRegex = /^export\s+const\s+(\w+)\s*=\s*(.+)$/gm;
  const exports: Record<string, unknown> = {};
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(body)) !== null) {
    const key = match[1];
    const rawValue = match[2];
    if (key && key.length > 0 && rawValue) {
      try {
        const jsonValue = rawValue
          .replace(/'/g, '"') // Single quotes → double quotes
          .replace(/(\w+):/g, '"$1":') // Unquoted keys → quoted keys
          .replace(/,\s*}/g, "}"); // Trailing commas

        exports[key] = JSON.parse(jsonValue);
      } catch {
        exports[key] = rawValue.replace(/^['"`]|['"`]$/g, "");
      }
    }
  }

  const cleanedBody = body.replace(exportRegex, "");
  return { body: cleanedBody, exports };
}

export async function extractFrontmatter(
  content: string,
  providedFrontmatter?: Record<string, unknown>,
): Promise<FrontmatterExtractionResult> {
  let body = content;
  let frontmatter = providedFrontmatter || {};

  if (!providedFrontmatter && content.trim().startsWith("---")) {
    const yamlResult = await extractYamlFrontmatter(content);
    body = yamlResult.body;
    frontmatter = yamlResult.frontmatter;
  }

  const exportResult = extractExportConstants(body);
  body = exportResult.body;
  frontmatter = { ...frontmatter, ...exportResult.exports };

  logger.info("Extracted frontmatter:", frontmatter);

  return { body, frontmatter };
}
