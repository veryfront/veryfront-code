import type { ErrorCategory, RegisteredError } from "./types.ts";

export type ErrorRegistryMap = Readonly<Record<string, RegisteredError>>;

const ERROR_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "CONFIG",
  "BUILD",
  "RUNTIME",
  "ROUTE",
  "MODULE",
  "SERVER",
  "BOUNDARY",
  "DEV",
  "DEPLOY",
  "AGENT",
  "GENERAL",
]);

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
): Readonly<ComposedSlugMap<Fragments>> {
  const composed: Record<string, unknown> = Object.create(null);
  const capitalizedCollectionName = collectionName.charAt(0).toUpperCase() +
    collectionName.slice(1);

  for (const fragment of fragments) {
    for (const [key, entry] of Object.entries(fragment)) {
      if (typeof entry !== "object" || entry === null || !Object.hasOwn(entry, "slug")) {
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

  return Object.freeze(composed) as Readonly<ComposedSlugMap<Fragments>>;
}

export function composeErrorRegistry<const Fragments extends readonly ErrorRegistryMap[]>(
  ...fragments: Fragments
): Readonly<ComposedSlugMap<Fragments>> {
  for (const fragment of fragments) {
    for (const definition of Object.values(fragment)) {
      if (
        typeof definition.slug !== "string" ||
        definition.slug.length < 3 ||
        definition.slug.length > 40 ||
        !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(definition.slug)
      ) {
        throw new TypeError(
          `Registered error slug must be 3-40 characters of lowercase kebab-case, got "${definition.slug}"`,
        );
      }
      if (
        typeof definition.category !== "string" ||
        !ERROR_CATEGORIES.has(definition.category)
      ) {
        throw new TypeError(`Registered error has unknown category "${definition.category}"`);
      }
      if (
        !Number.isInteger(definition.status) || definition.status < 400 ||
        definition.status >= 600
      ) {
        throw new RangeError(
          `Registered error status must be an integer from 400 through 599, got ${definition.status}`,
        );
      }
      if (typeof definition.title !== "string" || definition.title.trim().length === 0) {
        throw new TypeError("Registered error title must be a non-empty string");
      }
      if (
        definition.suggestion !== undefined &&
        (typeof definition.suggestion !== "string" ||
          definition.suggestion.trim().length === 0)
      ) {
        throw new TypeError("Registered error suggestion must be non-empty when provided");
      }
    }
  }

  return composeSluggedMaps("error registry", ...fragments);
}

export function getRegistryEntry<
  Registry extends ErrorRegistryMap,
  Slug extends Extract<keyof Registry, string>,
>(registry: Registry, slug: Slug): Registry[Slug];
export function getRegistryEntry(
  registry: ErrorRegistryMap,
  slug: string,
): RegisteredError | undefined;
export function getRegistryEntry(
  registry: ErrorRegistryMap,
  slug: string,
): RegisteredError | undefined {
  return Object.hasOwn(registry, slug) ? registry[slug] : undefined;
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
