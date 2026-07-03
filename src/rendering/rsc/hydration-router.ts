/**
 * Wraps a hydrated client component in the framework's reactive `RouterProvider`
 * so `useRouter()` / `usePageContext()` update on client-side navigation.
 *
 * The provider is loaded via a runtime `import(specifier)` (not a static import)
 * so the bundler leaves it alone and it resolves through the page's import map —
 * the same React instance the hydrated component uses. Wrapping under a
 * different React copy would break hooks ("Invalid hook call").
 */

import {
  type ClientRuntimeHydrationData,
  getHydrationRouterImportSpecifier,
} from "./client-module-strategy.ts";

interface ReactLike {
  // Matches React's `createElement` loosely enough that either the statically
  // imported React or the dynamically imported one satisfies it.
  // deno-lint-ignore no-explicit-any
  createElement: (type: any, props?: any, ...children: any[]) => any;
}

function currentHref(): string {
  const loc = globalThis.location;
  return loc ? `${loc.pathname}${loc.search}` : "/";
}

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
  React: ReactLike,
  child: T,
  hydrationData: ClientRuntimeHydrationData | null,
  doc: Document = document,
): Promise<T> {
  try {
    const specifier = getHydrationRouterImportSpecifier(doc);
    if (!specifier) return child;

    const mod = await import(specifier);
    const RouterProvider = (mod as { RouterProvider?: unknown }).RouterProvider;
    if (typeof RouterProvider !== "function") return child;

    return React.createElement(
      RouterProvider,
      {
        initialHref: currentHref(),
        params: normalizeParams(hydrationData?.params),
        frontmatter: hydrationData?.frontmatter ?? {},
      },
      child,
    ) as T;
  } catch (error) {
    console.debug?.("[RSC] router provider wrap failed", error);
    return child;
  }
}
