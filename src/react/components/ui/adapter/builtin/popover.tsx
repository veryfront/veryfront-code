/**
 * Builtin Popover adapter - a behaviour-preserving wrapper over the existing
 * `createAnchoredSurfaceParts()` machinery. This is the default, zero-dependency
 * engine: nothing about the rendered output or behaviour changes versus the
 * pre-adapter `popover.tsx` that called the factory directly.
 *
 * The `<span className="relative inline-block">` positioning anchor now lives
 * entirely inside this builtin adapter (via `AnchoredRoot`) - it is no longer
 * part of the Popover *contract*, so a parts-based engine (Base UI) is free to
 * anchor on the trigger and emit no wrapper at all.
 *
 * @module react/components/ui/adapter/builtin/popover
 */
import { createAnchoredSurfaceParts } from "../../anchored-surface.tsx";
import type { PopoverParts } from "../contract.ts";

// One instance, created once at module scope - exactly as `popover.tsx` used to
// do. Keeping this distinct from the DropdownMenu instance preserves the
// per-skin context isolation (a nested menu must not close an enclosing
// popover).
const parts = createAnchoredSurfaceParts();

export const builtinPopover: PopoverParts = {
  Root: parts.AnchoredRoot,
  // `haspopup` is a builtin-machinery concern (Popover vs Menu differ only
  // here), so the builtin trigger supplies it and the skin stays engine-neutral.
  Trigger: (props) => <parts.AnchoredTrigger haspopup="dialog" {...props} />,
  // Already portals via `Floating` into the nearest `[data-vf-ui]`/`[data-vf-chat]`
  // token scope. `initialFocus` preserves the pre-adapter Popover behaviour
  // (focus moves into the surface on open); the skin no longer passes it.
  Content: (props) => <parts.AnchoredContent initialFocus {...props} />,
};
