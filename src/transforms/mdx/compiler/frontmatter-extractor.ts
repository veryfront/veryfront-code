import { rendererLogger as logger } from "@veryfront/utils";
import { extract } from "@veryfront/compat/std/front-matter-yaml.ts";

export interface FrontmatterExtractionResult {
  body: string;
  frontmatter: Record<string, unknown>;
}

function extractYamlFrontmatter(content: string): FrontmatterExtractionResult {
  if (!content.trim().startsWith("---")) {
    return { body: content, frontmatter: {} };
  }

  const extracted = extract(content);
  return {
    body: extracted.body,
    frontmatter: extracted.attrs as Record<string, unknown>,
  };
}

function extractExportConstants(body: string): { body: string; exports: Record<string, unknown> } {
  // Only match simple single-line exports with string, number, or boolean values
  // Avoid matching complex exports like arrays, objects, or functions
  const exportRegex =
    /^export\s+const\s+(\w+)\s*=\s*(['"`][^'"`\n]*['"`]|\d+(?:\.\d+)?|true|false|null)\s*;?\s*$/gm;
  const exports: Record<string, unknown> = {};
  const linesToRemove: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(body)) !== null) {
    const key = match[1];
    const rawValue = match[2];
    if (key && rawValue) {
      linesToRemove.push(match[0]);
      // Parse the value
      if (rawValue === "true") {
        exports[key] = true;
      } else if (rawValue === "false") {
        exports[key] = false;
      } else if (rawValue === "null") {
        exports[key] = null;
      } else if (/^\d+(?:\.\d+)?$/.test(rawValue)) {
        exports[key] = parseFloat(rawValue);
      } else {
        // Remove quotes from string values
        exports[key] = rawValue.replace(/^['"`]|['"`]$/g, "");
      }
    }
  }

  // Remove matched lines from body
  let cleanedBody = body;
  for (const line of linesToRemove) {
    cleanedBody = cleanedBody.replace(line, "");
  }
  return { body: cleanedBody, exports };
}

export function extractFrontmatter(
  content: string,
  providedFrontmatter?: Record<string, unknown>,
): FrontmatterExtractionResult {
  let body = content;
  let frontmatter: Record<string, unknown> = {};

  // Always extract YAML frontmatter from content if present
  // This ensures the body is stripped of frontmatter markers regardless of providedFrontmatter
  if (content.trim().startsWith("---")) {
    const yamlResult = extractYamlFrontmatter(content);
    body = yamlResult.body;
    frontmatter = yamlResult.frontmatter;
  }

  // Merge provided frontmatter on top of extracted frontmatter
  if (providedFrontmatter) {
    frontmatter = { ...frontmatter, ...providedFrontmatter };
  }

  const exportResult = extractExportConstants(body);
  body = exportResult.body;
  frontmatter = { ...frontmatter, ...exportResult.exports };

  logger.debug("Extracted frontmatter:", frontmatter);

  return { body, frontmatter };
}
