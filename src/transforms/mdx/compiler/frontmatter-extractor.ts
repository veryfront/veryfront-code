import { rendererLogger as logger } from "#veryfront/utils/logger/logger.ts";
import { extract } from "#veryfront/compat/std/front-matter-yaml.ts";

export interface FrontmatterExtractionResult {
  body: string;
  frontmatter: Record<string, unknown>;
}

const FRONTMATTER_SYNTAX_ERROR = Symbol.for("veryfront.transforms.mdx.frontmatter-syntax-error");
const ObjectDefineProperty = Object.defineProperty;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;

/** Return true when an error came from MDX or Markdown YAML frontmatter parsing. */
export function isFrontmatterSyntaxError(error: unknown): error is SyntaxError {
  try {
    if (!(error instanceof SyntaxError)) return false;
    const descriptor = ReflectGetOwnPropertyDescriptor(error, FRONTMATTER_SYNTAX_ERROR);
    return descriptor !== undefined &&
      ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) === true &&
      descriptor.value === true;
  } catch {
    return false;
  }
}

function createFrontmatterSyntaxError(cause: SyntaxError): SyntaxError {
  const error = new SyntaxError(`Invalid YAML frontmatter: ${cause.message}`, { cause });
  ObjectDefineProperty(error, FRONTMATTER_SYNTAX_ERROR, { value: true });
  return error;
}

function extractYamlFrontmatter(content: string): FrontmatterExtractionResult {
  if (!content.trim().startsWith("---")) return { body: content, frontmatter: {} };

  let extracted;
  try {
    extracted = extract(content);
  } catch (error) {
    if (error instanceof SyntaxError) throw createFrontmatterSyntaxError(error);
    throw error;
  }

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
