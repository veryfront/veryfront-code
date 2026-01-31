import { rendererLogger as logger } from "#veryfront/utils";
import { extract } from "#veryfront/compat/std/front-matter-yaml.ts";

export interface FrontmatterExtractionResult {
  body: string;
  frontmatter: Record<string, unknown>;
}

function extractYamlFrontmatter(content: string): FrontmatterExtractionResult {
  if (!content.trim().startsWith("---")) return { body: content, frontmatter: {} };

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
  const exportRegex =
    /^export\s+const\s+(\w+)\s*=\s*(['"`][^'"`\n]*['"`]|\d+(?:\.\d+)?|true|false|null)\s*;?\s*$/gm;

  const exports: Record<string, unknown> = {};
  let cleanedBody = body;
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(body)) !== null) {
    const key = match[1];
    const rawValue = match[2];
    if (!key || !rawValue) continue;

    exports[key] = parseExportValue(rawValue);
    cleanedBody = cleanedBody.replace(match[0], "");
  }

  return { body: cleanedBody, exports };
}

export function extractFrontmatter(
  content: string,
  providedFrontmatter?: Record<string, unknown>,
): FrontmatterExtractionResult {
  const { body: yamlBody, frontmatter: yamlFrontmatter } = extractYamlFrontmatter(content);

  const { body, exports } = extractExportConstants(yamlBody);

  const frontmatter: Record<string, unknown> = {
    ...yamlFrontmatter,
    ...(providedFrontmatter ?? {}),
    ...exports,
  };

  logger.debug("Extracted frontmatter:", frontmatter);

  return { body, frontmatter };
}
