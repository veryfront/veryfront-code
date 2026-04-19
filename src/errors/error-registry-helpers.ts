import type { ErrorCategory, RegisteredError } from "./types.ts";

export type ErrorRegistryMap = Record<string, RegisteredError>;

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
