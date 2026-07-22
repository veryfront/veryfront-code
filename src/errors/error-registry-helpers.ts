import type { ErrorCategory, RegisteredError } from "./types.ts";

export type ErrorRegistryMap = Readonly<Record<string, RegisteredError>>;

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void ? Intersection : never;

type ComposedSlugMap<Fragments extends readonly object[]> = UnionToIntersection<
  Fragments[number]
>;

/**
 * Compose slug-keyed fragments without object-spread's silent last-write-wins behavior.
 */
export function composeSluggedMaps<const Fragments extends readonly object[]>(
  collectionName: string,
  ...fragments: Fragments
): ComposedSlugMap<Fragments> {
  const composed: Record<string, unknown> = {};
  const capitalizedCollectionName = collectionName.charAt(0).toUpperCase() +
    collectionName.slice(1);

  for (const fragment of fragments) {
    for (const [key, entry] of Object.entries(fragment)) {
      if (typeof entry !== "object" || entry === null || !("slug" in entry)) {
        throw new Error(`${capitalizedCollectionName} entry "${key}" must define a slug`);
      }

      const slug = (entry as { slug?: unknown }).slug;
      if (typeof slug !== "string") {
        throw new Error(`${capitalizedCollectionName} entry "${key}" must define a string slug`);
      }
      if (slug !== key) {
        throw new Error(
          `${capitalizedCollectionName} key "${key}" does not match entry slug "${slug}"`,
        );
      }
      if (Object.hasOwn(composed, key)) {
        throw new Error(`Duplicate ${collectionName} slug "${key}"`);
      }

      composed[key] = entry;
    }
  }

  return composed as ComposedSlugMap<Fragments>;
}

export function composeErrorRegistry<const Fragments extends readonly ErrorRegistryMap[]>(
  ...fragments: Fragments
): ComposedSlugMap<Fragments> {
  return composeSluggedMaps("error registry", ...fragments);
}

export function getRegistryEntry<
  Registry extends ErrorRegistryMap,
  Slug extends keyof Registry,
>(registry: Registry, slug: Slug): Registry[Slug] {
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
