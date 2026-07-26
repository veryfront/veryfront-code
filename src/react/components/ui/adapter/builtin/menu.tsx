/**
 * Builtin DropdownMenu adapter — a behaviour-preserving wrapper over
 * `createAnchoredSurfaceParts()`. Uses its OWN factory instance (distinct from
 * `builtinPopover`'s), preserving the per-skin context isolation guarantee: a
 * Popover nested inside a menu cannot accidentally close the menu.
 *
 * @module react/components/ui/adapter/builtin/menu
 */
import * as React from "react";
import { createAnchoredSurfaceParts } from "../../anchored-surface.tsx";
import type { MenuParts, ModalState } from "../contract.ts";

const parts = createAnchoredSurfaceParts();

export const builtinMenu: MenuParts = {
  Root: parts.AnchoredRoot,
  // `aria-haspopup="menu"` is the builtin trigger's concern (Menu vs Popover
  // differ only here), keeping the skin engine-neutral.
  Trigger: (props) => <parts.AnchoredTrigger haspopup="menu" {...props} />,
  Content: parts.AnchoredContent,
  useMenu: (): ModalState | null => {
    const ctx = React.useContext(parts.Context);
    return ctx ? { open: ctx.open, setOpen: ctx.setOpen } : null;
  },
};
