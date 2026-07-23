import { ERROR_REGISTRY, type ErrorSlug } from "../error-registry.ts";
import type { ErrorSolution } from "./types.ts";
import { hasUnsafeControlCharacters } from "../text-validation.ts";

/** Input accepted when defining a catalog solution. */
export type ErrorSolutionConfig = Omit<ErrorSolution, "slug" | "docs"> & {
  /** Override the canonical documentation URL. */
  readonly docs?: string;
};

function snapshotStrings(
  value: readonly string[] | undefined,
  field: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError(`${field} must be a bounded string array`);
  }
  const snapshot = value.map((entry) => {
    if (
      typeof entry !== "string" || entry.trim().length === 0 || entry.length > 4_096 ||
      hasUnsafeControlCharacters(entry, true)
    ) {
      throw new TypeError(`${field} must contain valid strings`);
    }
    return entry;
  });
  return Object.freeze(snapshot);
}

function snapshotText(
  value: unknown,
  field: string,
  maximumLength: number,
  optional = false,
): string | undefined {
  if (value === undefined && optional) return undefined;
  if (
    typeof value !== "string" || value.length > maximumLength ||
    (!optional && value.trim().length === 0) ||
    hasUnsafeControlCharacters(value, true)
  ) {
    throw new TypeError(`${field} must be a valid string`);
  }
  return value;
}

function assertRegisteredSlug(value: unknown, field: string): ErrorSlug {
  if (typeof value !== "string" || !Object.hasOwn(ERROR_REGISTRY, value)) {
    throw new TypeError(`${field} must be a registered error slug`);
  }
  return value as ErrorSlug;
}

function snapshotDocsUrl(value: unknown): string {
  const docs = snapshotText(value, "docs", 4_096) as string;
  let url: URL;
  try {
    url = new URL(docs);
  } catch {
    throw new TypeError("docs must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("docs must be an absolute HTTPS URL without credentials");
  }
  return url.href;
}

/** Create an immutable, validated error-catalog entry. */
export function createErrorSolution(
  slug: ErrorSlug,
  config: ErrorSolutionConfig,
): ErrorSolution {
  try {
    if (!config || typeof config !== "object") {
      throw new TypeError("config must be an object");
    }
    const registeredSlug = assertRegisteredSlug(slug, "slug");
    const title = config.title;
    const message = config.message;
    const steps = config.steps;
    const example = config.example;
    const docs = config.docs;
    const relatedErrors = config.relatedErrors;
    const tips = config.tips;
    const relatedErrorSnapshot = snapshotStrings(relatedErrors, "relatedErrors")?.map((entry) =>
      assertRegisteredSlug(entry, "relatedErrors")
    );
    return Object.freeze({
      slug: registeredSlug,
      title: snapshotText(title, "title", 512) as string,
      message: snapshotText(message, "message", 4_096) as string,
      steps: snapshotStrings(steps, "steps"),
      example: snapshotText(example, "example", 32_768, true),
      docs: snapshotDocsUrl(
        docs ?? `https://veryfront.com/docs/errors/${registeredSlug}`,
      ),
      relatedErrors: relatedErrorSnapshot === undefined
        ? undefined
        : Object.freeze(relatedErrorSnapshot),
      tips: snapshotStrings(tips, "tips"),
    });
  } catch {
    throw new TypeError("Invalid error solution");
  }
}

/** Create a catalog entry with title, message, and recovery steps. */
export function createSimpleError(
  slug: ErrorSlug,
  title: string,
  message: string,
  steps: readonly string[],
): ErrorSolution {
  return createErrorSolution(slug, { title, message, steps });
}
