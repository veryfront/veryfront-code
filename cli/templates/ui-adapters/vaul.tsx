/**
 * Vaul adapter for `veryfront/ui` — REFERENCE TEMPLATE (drawer SPECIALIST).
 *
 * Vaul (https://vaul.emilkowal.ski) is the best-in-class drag-to-dismiss drawer.
 * Unlike the full engines (Base UI / Radix / …), it is a SPECIALIST: it powers
 * exactly one slot — `drawer` — with real drag physics, snap points, and velocity
 * dismissal that a generic dialog can't express. Everything else stays on whatever
 * adapter is already active (builtin by default), because a `PartialUIAdapter`
 * merges over the parent.
 *
 * `npx veryfront generate adapter vaul` copies this file into YOUR repo
 * (`./ui-adapters/vaul.tsx`); `vaul` is YOUR dependency. Wire it up once:
 *
 * ```tsx
 * import { UIAdapterProvider } from "veryfront/ui";
 * import { vaulAdapter } from "./ui-adapters/vaul.tsx";
 *
 * // Drawers now drag-to-dismiss; the <Drawer> call-site + skin are unchanged.
 * <UIAdapterProvider adapter={vaulAdapter}>{app}</UIAdapterProvider>;
 * ```
 *
 * Stack it under a full engine to get Vaul drawers + (say) Base UI overlays:
 * `<UIAdapterProvider adapter={baseUiAdapter}><UIAdapterProvider adapter={vaulAdapter}>…`.
 *
 * @module ui-adapters/vaul
 */
import * as React from "react";
import { Drawer as Vaul } from "vaul";
import { useTokenScope } from "veryfront/ui";
import type { DrawerParts, UIAdapter } from "veryfront/ui";

/** Resolve the veryfront token-scope element so the portalled sheet keeps `var(--…)`. */
function useScopedContainer(): { ref: React.Ref<HTMLElement>; container: HTMLElement | null } {
  const { ref, getContainer } = useTokenScope();
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => setContainer(getContainer()), [getContainer]);
  return { ref, container };
}

export const vaulDrawer: DrawerParts = {
  Root: ({ open, defaultOpen, onOpenChange, direction = "bottom", children }) => (
    <Vaul.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      direction={direction}
    >
      {children}
    </Vaul.Root>
  ),
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <Vaul.Trigger asChild {...rest}>{children}</Vaul.Trigger>
      : <Vaul.Trigger {...rest}>{children}</Vaul.Trigger>,
  Content: ({ className, children, lead, ...rest }) => {
    const { ref, container } = useScopedContainer();
    return (
      <>
        <span ref={ref} hidden aria-hidden="true" />
        <Vaul.Portal container={container ?? undefined}>
          <Vaul.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)]" />
          <Vaul.Content className={className} data-vf-state="open" {...rest}>
            {/* The skin's drag-handle node; Vaul drags the whole content. */}
            {lead}
            {children}
          </Vaul.Content>
        </Vaul.Portal>
      </>
    );
  },
  Close: ({ asChild, children, ...rest }) =>
    asChild
      ? <Vaul.Close asChild {...rest}>{children}</Vaul.Close>
      : <Vaul.Close {...rest}>{children}</Vaul.Close>,
};

/**
 * Vaul specialist adapter — maps ONLY `drawer`. Merge it over any other adapter
 * (or the builtin default) to get real drag-to-dismiss drawers; every other
 * primitive is untouched.
 */
export const vaulAdapter: Partial<UIAdapter> & { name: string } = {
  name: "vaul",
  drawer: vaulDrawer,
};
