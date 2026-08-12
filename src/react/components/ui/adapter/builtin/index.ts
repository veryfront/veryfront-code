/**
 * The builtin adapter: today's zero-dependency machinery, assembled as a
 * `UIAdapter`. This is the default value of `useAdapter()`, so the "no provider"
 * path and the "provider" path are one code path.
 *
 * @module react/components/ui/adapter/builtin
 */
import type { UIAdapter } from "../contract.ts";
import { builtinToast } from "./toast.tsx";
import { builtinDisclosure } from "./disclosure.tsx";
import { builtinToggleGroup } from "./toggle-group.tsx";
import { builtinToolbar } from "./toolbar.tsx";
import { builtinDialog } from "./dialog.tsx";
import { builtinDrawer } from "./drawer.tsx";

export const builtinAdapter: UIAdapter = {
  name: "builtin",
  toast: builtinToast,
  disclosure: builtinDisclosure,
  toggleGroup: builtinToggleGroup,
  toolbar: builtinToolbar,
  dialog: builtinDialog,
  drawer: builtinDrawer,
};
