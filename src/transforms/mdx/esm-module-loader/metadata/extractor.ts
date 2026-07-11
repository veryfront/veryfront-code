import { rendererLogger } from "#veryfront/utils";
import type { FrontmatterMetadata, LogContext, MDXModule } from "../../module-loader/types.ts";
import { extractBalancedBlock, parseJsonish } from "./string-parser.ts";

const logger = rendererLogger.component("mdx");

export function extractFrontmatter(moduleCode: string): FrontmatterMetadata | undefined {
  const fmIndex = moduleCode.search(/(?:export\s+)?const\s+frontmatter\s*=\s*/);
  if (fmIndex < 0) return undefined;

  const braceStart = moduleCode.indexOf("{", fmIndex);
  if (braceStart < 0) return undefined;

  const raw = extractBalancedBlock(moduleCode, braceStart, "{", "}");
  if (!raw) return undefined;

  // Convert JS object literal syntax to JSON.
  // Key-quoting is restricted to structural positions (after `{` or `,`) so
  // that colons inside already-quoted values — e.g. URLs like `"https://…"` —
  // are never mistaken for key-value separators.
  // Single-quote replacement is limited to values without apostrophes; values
  // containing apostrophes must already use double-quotes in the source.
  const jsonish = raw
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'([^']*)'/g, '"$1"');

  try {
    return JSON.parse(jsonish) as FrontmatterMetadata;
  } catch (e) {
    logger.debug("frontmatter JSON parse failed", e as LogContext);
    return undefined;
  }
}

interface MetadataPattern {
  regex: RegExp;
  key: keyof MDXModule;
}

// Scalar patterns — simple string, boolean, or inline-string values whose
// capture group cannot span multiple lines.
const METADATA_PATTERNS: MetadataPattern[] = [
  { regex: /(?:export\s+)?const\s+title\s*=\s*["']([^"']+)["']/, key: "title" },
  { regex: /(?:export\s+)?const\s+description\s*=\s*["']([^"']+)["']/, key: "description" },
  { regex: /(?:export\s+)?const\s+layout\s*=\s*(true|false|["'][^"']+["'])/, key: "layout" },
  { regex: /(?:export\s+)?const\s+date\s*=\s*["']([^"']+)["']/, key: "date" },
  { regex: /(?:export\s+)?const\s+draft\s*=\s*(true|false)/, key: "draft" },
];

// Complex patterns — array or object literals that may contain nested
// structures.  Non-greedy regex stops at the first closing delimiter it sees,
// so `[{…},{…}]` would be truncated at the inner `]` when elements are nested
// arrays.  We use `extractBalancedBlock` instead to handle arbitrary nesting.
interface ComplexMetadataPattern {
  varName: string;
  key: keyof MDXModule;
  open: "[" | "{";
}

const COMPLEX_METADATA_PATTERNS: ComplexMetadataPattern[] = [
  { varName: "headings", key: "headings", open: "[" },
  { varName: "tags", key: "tags", open: "[" },
  { varName: "nested", key: "nested", open: "{" },
];

function extractComplexValue(
  moduleCode: string,
  varName: string,
  open: "[" | "{",
): string | undefined {
  const pattern = new RegExp(`(?:export\\s+)?const\\s+${varName}\\s*=\\s*`);
  const matchResult = pattern.exec(moduleCode);
  if (!matchResult) return undefined;

  const valueStart = moduleCode.indexOf(open, matchResult.index + matchResult[0].length);
  if (valueStart < 0) return undefined;

  return extractBalancedBlock(moduleCode, valueStart, open) || undefined;
}

function parseLayoutValue(value: string): boolean | string {
  if (value === "true") return true;
  if (value === "false") return false;
  return value.replace(/^"|"$/g, "");
}

export function extractMetadata(moduleCode: string): Partial<MDXModule> {
  const exports: Partial<MDXModule> = {};

  for (const { regex, key } of METADATA_PATTERNS) {
    const match = moduleCode.match(regex);
    if (!match) continue;

    const value = match[1];

    if (key === "title" || key === "description" || key === "date") {
      exports[key] = value;
      continue;
    }

    if (key === "draft") {
      exports[key] = value === "true";
      continue;
    }

    if (key === "layout") {
      if (value !== undefined) exports[key] = parseLayoutValue(value);
      continue;
    }

    try {
      if (value !== undefined) exports[key] = parseJsonish(value) as never;
    } catch (e) {
      logger.warn(`Failed to parse ${String(key)}`, e);
    }
  }

  // Extract array/object values using balanced-block parsing to correctly
  // handle nested arrays or objects (e.g. headings with children arrays).
  for (const { varName, key, open } of COMPLEX_METADATA_PATTERNS) {
    const value = extractComplexValue(moduleCode, varName, open);
    if (value === undefined) continue;

    try {
      exports[key] = parseJsonish(value) as never;
    } catch (e) {
      logger.warn(`Failed to parse ${String(key)}`, e);
    }
  }

  return exports;
}

const FRONTMATTER_KEYS: (keyof MDXModule)[] = [
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
  result.frontmatter ??= {};

  for (const key of FRONTMATTER_KEYS) {
    const value = result[key];
    if (value !== undefined && result.frontmatter[key] === undefined) {
      result.frontmatter[key] = value;
    }
  }
}
