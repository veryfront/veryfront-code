import { extract } from "#veryfront/compat/std/front-matter-yaml.ts";
import { rendererLogger as logger } from "#veryfront/utils/logger/logger.ts";
import type { ContentFrontmatterResult } from "#veryfront/extensions/content/index.ts";

/** @deprecated Prefer {@link ContentFrontmatterResult}. */
export type FrontmatterExtractionResult = ContentFrontmatterResult;

function assignFrontmatterData(
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
  path: string,
): void {
  if (source === undefined) return;
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new TypeError(`${path} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(source);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError(`${path} cannot contain enumerable symbol keys`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`${path}.${key} must be a data property`);
    }
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
}

/**
 * Merge frontmatter records in precedence order without invoking accessors.
 *
 * Each tuple supplies a record and the path used in validation errors.
 */
export function mergeFrontmatter(
  ...sources: ReadonlyArray<
    readonly [Record<string, unknown> | undefined, string]
  >
): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};
  for (const [source, path] of sources) {
    assignFrontmatterData(frontmatter, source, path);
  }
  return frontmatter;
}

/**
 * Extract dependency-free YAML frontmatter and merge caller-provided values.
 *
 * Syntax-aware static JavaScript metadata belongs to the registered content
 * processor, whose parser implementation lives outside dependency-free core.
 */
export function extractFrontmatter(
  content: string,
  providedFrontmatter?: Record<string, unknown>,
): ContentFrontmatterResult {
  const yamlContent = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const extracted = /^---(?:\r\n|\r|\n|$)/.test(yamlContent) ? extract(yamlContent) : undefined;
  const body = extracted?.body ?? content;
  const yamlFrontmatter = extracted?.attrs as
    | Record<string, unknown>
    | undefined;
  const frontmatter = mergeFrontmatter(
    [yamlFrontmatter, "YAML frontmatter"],
    [providedFrontmatter, "Provided frontmatter"],
  );

  logger.debug("Extracted frontmatter", {
    fieldCount: Object.keys(frontmatter).length,
  });
  return { body, frontmatter };
}
