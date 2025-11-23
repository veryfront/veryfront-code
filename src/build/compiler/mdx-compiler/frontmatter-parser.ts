import { extract } from "std/front_matter/yaml.ts";
import { bundlerLogger as logger } from "@veryfront/utils";
import type { MDXFrontmatter } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface ParsedContent {
  frontmatter: MDXFrontmatter;
  content: string;
}

export async function parseFrontmatter(content: string): Promise<ParsedContent> {
  let frontmatter: MDXFrontmatter = {};
  let mdxContent = content;

  try {
    const result = extract(content);
    frontmatter = result.attrs ? result.attrs as MDXFrontmatter : {};
    mdxContent = result.body;
  } catch {
    const manualResult = await parseManually(content);
    if (manualResult) {
      frontmatter = manualResult.frontmatter;
      mdxContent = manualResult.content;
    }
  }

  return { frontmatter, content: mdxContent };
}

async function parseManually(content: string): Promise<ParsedContent | null> {
  if (!content.startsWith("---")) {
    return null;
  }

  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1]) {
    return null;
  }

  try {
    const { parse } = await import("std/yaml/parse.ts");

    const parsed = parse(match[1]);
    const frontmatter = (parsed && typeof parsed === "object" ? parsed : {}) as MDXFrontmatter;
    if (!match[2]) {
      throw toError(createError({
        type: "build",
        message: "MDX content missing after frontmatter",
      }));
    }
    const mdxContent = String(match[2]);
    return { frontmatter, content: mdxContent };
  } catch (error) {
    logger.error("Failed to parse YAML frontmatter:", error);
    return null;
  }
}

export function extractExports(content: string): { frontmatter: MDXFrontmatter; content: string } {
  const frontmatter: MDXFrontmatter = {};
  const exportRegex = /^export\s+const\s+(\w+)\s*=\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(content)) !== null) {
    const [, key, value] = match;
    if (typeof key === "string" && key.length > 0 && value) {
      frontmatter[key] = parseExportValue(value);
    }
  }

  const cleanedContent = content.replace(exportRegex, "");
  return { frontmatter, content: cleanedContent };
}

function parseExportValue(value: string): unknown {
  const trimmed = value.trim();

  try {
    if (
      trimmed.startsWith("{") ||
      trimmed.startsWith("[") ||
      trimmed === "true" ||
      trimmed === "false" ||
      trimmed === "null" ||
      !isNaN(Number(trimmed))
    ) {
      return JSON.parse(trimmed);
    }

    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
      return trimmed.slice(1, -1);
    }

    return trimmed;
  } catch {
    return trimmed.replace(/^['"]|['"]$/g, "");
  }
}
