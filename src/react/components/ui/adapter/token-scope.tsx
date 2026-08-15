/**
 * `useTokenScope` - resolve the nearest `[data-vf-ui]` / `[data-vf-chat]` token
 * scope for portalling. Every adapter's floating surface (Popover, Menu,
 * Tooltip, Select, Dialog) MUST portal INTO this scope rather than `<body>`,
 * because the design tokens are scoped there - a surface under `<body>` resolves
 * every `var(--…)` to nothing (transparent background, wrong text color). This
 * is the single scope-resolution helper the builtin and any third-party adapter
 * share, so the invariant is enforced identically everywhere (see the mandatory
 * token-scope conformance test).
 *
 * @module react/components/ui/adapter/token-scope
 */
import * as React from "react";
import { UI_SCOPE_SELECTOR } from "../design-tokens.ts";

/**
 * Returns a `ref` to attach to any element inside the token scope, plus a
 * `getContainer()` that resolves the nearest scope element (falling back to
 * `document.body`). Third-party adapters use this to feed their portal
 * `container` (e.g. Base UI's `<Portal container={…}>`).
 */
export function useTokenScope(): {
  ref: React.RefObject<HTMLSpanElement | null>;
  getContainer: () => HTMLElement;
} {
  const ref = React.useRef<HTMLSpanElement>(null);
  const getContainer = React.useCallback(
    (): HTMLElement =>
      ref.current?.closest<HTMLElement>(UI_SCOPE_SELECTOR) ??
        (typeof document !== "undefined" ? document.body : (null as never)),
    [],
  );
  return { ref, getContainer };
}
