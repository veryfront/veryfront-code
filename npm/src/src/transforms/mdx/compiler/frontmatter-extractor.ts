import { rendererLogger as logger } from "../../../utils/index.js";
import { extract } from "../../../platform/compat/std/front-matter-yaml.js";

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

function parseExportValue(rawValue: string): unknown {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "null") return null;
  if (/^\d+(?:\.\d+)?$/.test(rawValue)) return parseFloat(rawValue);

  return rawValue.replace(/^['"`]|['"`]$/g, "");
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

    if (!key || !rawValue) continue;

    linesToRemove.push(match[0]);
    exports[key] = parseExportValue(rawValue);
  }

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
  const yamlResult = extractYamlFrontmatter(content);
  let body = yamlResult.body;

  let frontmatter: Record<string, unknown> = {
    ...yamlResult.frontmatter,
    ...(providedFrontmatter ?? {}),
  };

  const exportResult = extractExportConstants(body);
  body = exportResult.body;
  frontmatter = { ...frontmatter, ...exportResult.exports };

  logger.debug("Extracted frontmatter:", frontmatter);

  return { body, frontmatter };
}
