import { extract } from "../../../platform/compat/std/front-matter-yaml.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { bundlerLogger as logger } from "../../../utils/index.js";
import type { MDXFrontmatter } from "./types.js";

export interface ParsedContent {
  frontmatter: MDXFrontmatter;
  content: string;
}

export async function parseFrontmatter(content: string): Promise<ParsedContent> {
  try {
    const result = extract(content);
    return {
      frontmatter: (result.attrs ?? {}) as MDXFrontmatter,
      content: result.body,
    };
  } catch {
    const manualResult = await parseManually(content);
    if (manualResult) return manualResult;
    return { frontmatter: {}, content };
  }
}

async function parseManually(content: string): Promise<ParsedContent | null> {
  if (!content.startsWith("---")) return null;

  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatterText = match?.[1];
  if (!frontmatterText) return null;

  try {
    const { parse } = await import("../../../../deps/deno.land/std@0.220.0/yaml/parse.js");
    const parsed = parse(frontmatterText);
    const frontmatter = (parsed && typeof parsed === "object" ? parsed : {}) as MDXFrontmatter;

    const mdxBody = match?.[2];
    if (!mdxBody) {
      throw toError(
        createError({
          type: "build",
          message: "MDX content missing after frontmatter",
        }),
      );
    }

    return { frontmatter, content: String(mdxBody) };
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
    const key = match[1];
    const value = match[2];
    if (key && value) frontmatter[key] = parseExportValue(value);
  }

  return { frontmatter, content: content.replace(exportRegex, "") };
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
