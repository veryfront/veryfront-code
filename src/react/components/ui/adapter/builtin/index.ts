/**
 * The builtin adapter — today's zero-dependency machinery, assembled as a
 * `UIAdapter`. This is the default value of `useAdapter()`, so the "no provider"
 * path and the "provider" path are one code path.
 *
 * @module react/components/ui/adapter/builtin
 */
import type { UIAdapter } from "../contract.ts";
import { builtinPopover } from "./popover.tsx";
import { builtinDialog } from "./dialog.tsx";
import { builtinMenu } from "./menu.tsx";
import { builtinTooltip } from "./tooltip.tsx";
import { builtinSelect } from "./select.tsx";
import { builtinCombobox } from "./combobox.tsx";
import { builtinToast } from "./toast.tsx";
import { builtinDisclosure } from "./disclosure.tsx";
import { builtinToggleGroup } from "./toggle-group.tsx";
import { builtinToolbar } from "./toolbar.tsx";
import { builtinTabs } from "./tabs.tsx";

export const builtinAdapter: UIAdapter = {
  name: "builtin",
  popover: builtinPopover,
  dialog: builtinDialog,
  menu: builtinMenu,
  tooltip: builtinTooltip,
  select: builtinSelect,
  combobox: builtinCombobox,
  toast: builtinToast,
  disclosure: builtinDisclosure,
  toggleGroup: builtinToggleGroup,
  toolbar: builtinToolbar,
  tabs: builtinTabs,
};
