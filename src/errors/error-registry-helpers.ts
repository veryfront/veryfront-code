import type { ErrorCategory, RegisteredError } from "./types.ts";

export type ErrorRegistryMap = Record<string, RegisteredError>;

/** Merge registry fragments while rejecting duplicate or mismatched slugs. */
export function mergeRegistryFragments(
  ...fragments: readonly ErrorRegistryMap[]
): Readonly<ErrorRegistryMap> {
  const registry = Object.create(null) as ErrorRegistryMap;
  for (const fragment of fragments) {
    let entries: Array<[string, RegisteredError]>;
    try {
      if (!fragment || typeof fragment !== "object" || Array.isArray(fragment)) {
        throw new TypeError("Invalid error registry fragment");
      }
      entries = Object.entries(fragment);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Invalid error registry fragment");
    }

    for (const [slug, definition] of entries) {
      let definitionSlug: string;
      try {
        definitionSlug = definition.slug;
      } catch {
        throw new TypeError("Invalid error registry definition");
      }
      if (definitionSlug !== slug) {
        throw new TypeError(`Error slug ${definitionSlug} must match its registry key ${slug}`);
      }
      if (Object.hasOwn(registry, slug)) {
        throw new TypeError(`Duplicate error slug: ${slug}`);
      }
      Object.defineProperty(registry, slug, {
        configurable: false,
        enumerable: true,
        value: definition,
        writable: false,
      });
    }
  }
  return Object.freeze(registry);
}

export function getRegistryEntry<
  Registry extends ErrorRegistryMap,
  Slug extends keyof Registry,
>(registry: Registry, slug: Slug): Registry[Slug] {
  if (!Object.hasOwn(registry, slug)) {
    throw new TypeError("Unknown error slug");
  }
  return registry[slug];
}

export function getRegistryEntriesByCategory(
  registry: ErrorRegistryMap,
  category: ErrorCategory,
): RegisteredError[] {
  return Object.values(registry).filter((error) => error.category === category);
}

export function getRegistrySlugs<Registry extends ErrorRegistryMap>(
  registry: Registry,
): Array<keyof Registry> {
  return Object.keys(registry) as Array<keyof Registry>;
}
