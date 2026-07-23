# Client runtime

## Explanation

`src/client` contains browser-only runtime code that Veryfront serves as internal modules. It is
not a public `veryfront/*` import surface.

The SPA runtime follows this flow:

1. `ClientApp` snapshots and validates server-provided page data.
2. `component-loader` resolves page, app, and layout paths against the page's release asset map.
3. The loader deduplicates imports, schedules a bounded number of physical imports, and publishes
   successful components to a bounded LRU cache.
4. `LayoutShell` composes the page from the innermost layout to the outermost layout.
5. `RouterProvider` and `PageContextProvider` expose the completed route state to React code.

Navigation data is immutable after acceptance. A caller cannot change props, paths, headings, CSS,
or release mappings while an asynchronous navigation is loading. Stale navigations cannot publish
page state after a newer navigation completes.

The runtime treats module paths, release URLs, hydration data, and route CSS as untrusted transport
data. It rejects traversal, encoded delimiters, unsafe control characters, accessors, cycles,
unsupported JSON values, oversized containers, and ambiguous CSS actions before use.

## Reference

| File                          | Responsibility                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `spa/ClientApp.tsx`           | SPA lifecycle, navigation publication, route CSS, router context, and page render containment |
| `spa/LayoutShell.tsx`         | Ordered layout composition, asynchronous layout loading, and layout render containment        |
| `spa/component-loader.ts`     | Release-aware URL resolution, import deduplication, bounded scheduling, and component caching |
| `spa/page-data.ts`            | Immutable JSON-compatible snapshots and structural page-data validation                       |
| `spa/path-utils.ts`           | Module URL normalization and the equivalent standalone browser helper                         |
| `spa/RenderErrorBoundary.tsx` | Safe render fallback and navigation-driven recovery                                           |
| `spa/index.ts`                | Internal SPA barrel exports                                                                   |

`loadComponent`, `preloadComponent`, and `getCachedComponent` accept an optional
`ComponentLoadOptions` value. Pass `releaseAssetModules` and `releaseId` when a load must resolve
against a specific release. Omit the option only when the browser-global release context is the
intended source.
Fallback module URLs preserve the active release, Studio, or HMR cache context. This keeps hydration,
prefetch, navigation, and layout loads on the same resolved cache key.

`clearComponentCache` invalidates cached publications and queued work. JavaScript cannot cancel a
dynamic import that has already started, so active imports finish without repopulating an invalidated
cache or returning an invalidated component.

## Change guide

When page-data behavior changes, update the server transport type, hydration validation, this client
snapshot, and focused tests together. Keep route parameters consistent with server rendering:
catch-all arrays become slash-separated strings before React components receive them.

When module resolution changes, update both `pathToModuleUrl` and
`getPathToModuleUrlScript`. The path utility tests execute both implementations against the same
cases to prevent drift.

Run the scoped verification from the repository root:

```bash
deno test --no-check --allow-all src/client
rg --files src/client -g '*.ts' -g '*.tsx' | xargs deno check
deno lint src/client
deno fmt --check src/client
```
