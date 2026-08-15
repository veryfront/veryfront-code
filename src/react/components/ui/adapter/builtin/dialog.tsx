/**
 * Builtin Dialog adapter - a behaviour-preserving wrapper over the existing
 * `createModalSurfaceParts("Dialog")` machinery (overlay + centered panel,
 * Escape / overlay-click dismiss, first-focusable focus + restoration). The
 * default zero-dependency engine; nothing about the rendered output changes
 * versus the pre-adapter `dialog.tsx`.
 *
 * @module react/components/ui/adapter/builtin/dialog
 */
import { createModalSurfaceParts } from "../../modal-surface.tsx";
import type { DialogParts } from "../contract.ts";

// One instance at module scope - distinct from Drawer's so a nested DrawerClose
// cannot close an enclosing Dialog.
const parts = createModalSurfaceParts("Dialog");

export const builtinDialog: DialogParts = {
  Root: parts.ModalRoot,
  Trigger: parts.ModalTrigger,
  Content: parts.ModalContent,
  Close: parts.ModalClose,
  useDialog: parts.useModal,
};
