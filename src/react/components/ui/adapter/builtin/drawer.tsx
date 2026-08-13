/**
 * Builtin Drawer adapter — the zero-dependency STATIC bottom sheet: the shared
 * modal surface (overlay + panel, Escape/outside-click dismiss) assembled as
 * `DrawerParts`, with the drawer skin supplying the edge-slide layout. No drag
 * physics — for real drag-to-dismiss / snap points, vendor the **Vaul**
 * specialist adapter (`veryfront generate adapter vaul`) and swap it in via
 * `UIAdapterProvider`.
 *
 * @module react/components/ui/adapter/builtin/drawer
 */
import { createModalSurfaceParts } from "../../modal-surface.tsx";
import type { DrawerParts } from "../contract.ts";

// A distinct modal instance from Dialog's, so the two never share open-state.
const parts = createModalSurfaceParts("Drawer");

export const builtinDrawer: DrawerParts = {
  // `direction` is ignored by the builtin (the skin positions the sheet); it is
  // part of the contract for engines like Vaul that drive the slide direction.
  Root: ({ direction: _direction, ...props }) => <parts.ModalRoot {...props} />,
  Trigger: parts.ModalTrigger,
  Content: parts.ModalContent,
  Close: parts.ModalClose,
  useDrawer: parts.useModal,
};
