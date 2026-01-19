import { rendererLogger as logger } from "#veryfront/utils";
import type { FrontmatterMetadata, LogContext, MDXModule } from "./types.ts";
import { extractBalancedBlock, parseJsonish } from "./string-parser.ts";

export function extractFrontmatter(moduleCode: string): FrontmatterMetadata | undefined {
  try {
    const fmIndex = moduleCode.search(/(?:export\s+)?const\s+frontmatter\s*=\s*/);
    if (fmIndex < 0) return undefined;

    const braceStart = moduleCode.indexOf("{", fmIndex);
    if (braceStart < 0) return undefined;

    const raw = extractBalancedBlock(moduleCode, braceStart, "{", "}");
    if (!raw) return undefined;

    const jsonish = raw
      .replace(/([^\s"{[:,]+)\s*:/g, '"$1":')
      .replace(/'([^']*)'/g, '"$1"');

    try {
      return JSON.parse(jsonish) as FrontmatterMetadata;
    } catch (e) {
      logger.debug("[mdx] frontmatter JSON parse failed", e as LogContext);
      return undefined;
    }
  } catch (e) {
    logger.debug("[mdx] frontmatter extraction failed", e as LogContext);
    return undefined;
  }
}

interface MetadataPattern {
  regex: RegExp;
  key: string;
}

const METADATA_PATTERNS: MetadataPattern[] = [
  { regex: /(?:export\s+)?const\s+title\s*=\s*["']([^"']+)["']/, key: "title" },
  { regex: /(?:export\s+)?const\s+description\s*=\s*["']([^"']+)["']/, key: "description" },
  { regex: /(?:export\s+)?const\s+layout\s*=\s*(true|false|["'][^"']+["'])/, key: "layout" },
  { regex: /(?:export\s+)?const\s+headings\s*=\s*(\[[\s\S]*?\])/, key: "headings" },
  { regex: /(?:export\s+)?const\s+nested\s*=\s*({[\s\S]*?})/, key: "nested" },
  { regex: /(?:export\s+)?const\s+tags\s*=\s*(\[[\s\S]*?\])/, key: "tags" },
  { regex: /(?:export\s+)?const\s+date\s*=\s*["']([^"']+)["']/, key: "date" },
  { regex: /(?:export\s+)?const\s+draft\s*=\s*(true|false)/, key: "draft" },
];

function parseLayoutValue(value: string): boolean | string {
  if (value === "true") return true;
  if (value === "false") return false;
  return String(value).replace(/^"|"$/g, "");
}

export function extractMetadata(moduleCode: string): Partial<MDXModule> {
  const exports: Partial<MDXModule> = {};

  for (const { regex, key } of METADATA_PATTERNS) {
    const match = moduleCode.match(regex);
    if (!match) continue;

    const value = match[1] as string;

    // String fields: assign directly
    if (key === "title" || key === "description" || key === "date") {
      exports[key] = value;
      continue;
    }

    // Boolean field: parse as boolean
    if (key === "draft") {
      exports[key] = value === "true";
      continue;
    }

    // Layout field: parse as boolean or string
    if (key === "layout") {
      exports[key] = parseLayoutValue(value);
      continue;
    }

    // JSON-like fields: parse with jsonish parser
    try {
      exports[key] = parseJsonish(value) as never;
    } catch (e) {
      logger.warn(`Failed to parse ${key}`, e);
    }
  }

  return exports;
}

const FRONTMATTER_KEYS = [
  "title",
  "description",
  "layout",
  "headings",
  "tags",
  "date",
  "draft",
  "nested",
];

export function mergeFrontmatter(result: MDXModule): void {
  result.frontmatter = result.frontmatter ?? {};

  for (const key of FRONTMATTER_KEYS) {
    const value = result[key];
    if (value !== undefined && result.frontmatter[key] === undefined) {
      result.frontmatter[key] = value;
    }
  }
}
