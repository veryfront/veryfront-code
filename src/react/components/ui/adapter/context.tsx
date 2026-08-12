/**
 * `UIAdapterProvider` / `useAdapter`: the indirection that lets `veryfront/ui`
 * skins resolve their behavioural mechanics from a swappable adapter.
 *
 * - With **no provider**, `useAdapter()` returns the zero-dependency
 *   `builtinAdapter`, so nothing changes for no-dep users and there is exactly
 *   one code path.
 * - `UIAdapterProvider` accepts a **partial** map that merges over the builtin
 *   (and over any inherited parent adapter), so an app can override just
 *   `disclosure` and leave everything else zero-dependency.
 *
 * @module react/components/ui/adapter/context
 */
import * as React from "react";
import type { PartialUIAdapter, UIAdapter } from "./contract.ts";
import { builtinAdapter } from "./builtin/index.ts";

const UIAdapterContext = React.createContext<UIAdapter | null>(null);

/** Provide (a partial) UI-primitive adapter to the subtree. */
export function UIAdapterProvider(
  { adapter, children }: {
    adapter: PartialUIAdapter;
    children: React.ReactNode;
  },
): React.ReactElement {
  const parent = React.useContext(UIAdapterContext) ?? builtinAdapter;
  const merged = React.useMemo<UIAdapter>(
    () => ({
      name: adapter.name ?? parent.name,
      disclosure: adapter.disclosure ?? parent.disclosure,
      toast: adapter.toast ?? parent.toast,
      toggleGroup: adapter.toggleGroup ?? parent.toggleGroup,
      toolbar: adapter.toolbar ?? parent.toolbar,
      dialog: adapter.dialog ?? parent.dialog,
    }),
    [
      adapter.disclosure,
      adapter.name,
      adapter.toast,
      adapter.toggleGroup,
      adapter.toolbar,
      adapter.dialog,
      parent,
    ],
  );
  return (
    <UIAdapterContext.Provider value={merged}>
      {children}
    </UIAdapterContext.Provider>
  );
}

/** Resolve the active UI-primitive adapter. Never returns null (defaults to builtin). */
export function useAdapter(): UIAdapter {
  return React.useContext(UIAdapterContext) ?? builtinAdapter;
}
