/**
 * Wraps a hydrated client component in the framework's reactive `RouterProvider`
 * so `useRouter()` / `usePageContext()` update on client-side navigation.
 *
 * The provider is loaded via a runtime `import(specifier)` (not a static import)
 * so the bundler leaves it alone and it resolves through the page's import map —
 * the same React instance the hydrated component uses. The wrapping itself is
 * done by the module's own `wrapForHydration`, so no `React` is threaded across
 * the boundary (which is what forced the old `any`-typed `ReactLike` shim).
 */

import {
  type ClientRuntimeHydrationData,
  getHydrationRouterImportSpecifier,
} from "./client-module-strategy.ts";

/** Signature of `veryfront/router`'s `wrapForHydration` export. */
type WrapForHydration = <T>(
  child: T,
  options: { params?: Record<string, string>; frontmatter?: Record<string, unknown> },
) => T;

function normalizeParams(
  params: Record<string, string | string[]> | undefined,
): Record<string, string> {
  if (!params) return {};
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    flat[key] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return flat;
}

/**
 * Returns `child` wrapped in `RouterProvider`, seeded from the page's hydration
 * data. Falls back to the bare `child` if the provider cannot be loaded (e.g.
 * the import map does not own `veryfront/router`), so hydration still proceeds.
 */
export async function wrapWithRouterProvider<T>(
  child: T,
  hydrationData: ClientRuntimeHydrationData | null,
  doc: Document = document,
): Promise<T> {
  try {
    const specifier = getHydrationRouterImportSpecifier(doc);
    if (!specifier) return child;

    const mod = await import(specifier);
    const wrap = (mod as { wrapForHydration?: unknown }).wrapForHydration;
    if (typeof wrap !== "function") return child;

    return (wrap as WrapForHydration)(child, {
      params: normalizeParams(hydrationData?.params),
      frontmatter: hydrationData?.frontmatter ?? {},
    });
  } catch (error) {
    console.debug?.("[RSC] router provider wrap failed", error);
    return child;
  }
}
