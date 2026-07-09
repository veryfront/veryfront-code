import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as uiModule from "./index.ts";
import * as colorModeModule from "./color-mode.tsx";
import * as cvaModule from "./cva.ts";

// Exact runtime surface of `veryfront/ui`. Keep this list sorted and in sync
// with the barrel — a new primitive (or a removed one) must be an intentional,
// reviewed change to the public API, not an accidental widening. Type-only
// exports (e.g. `ButtonProps`) do not appear at runtime and are omitted.
const expectedRuntimeExports = [
  "Alert",
  "AlertAction",
  "AlertContent",
  "AlertIcon",
  "AppShell",
  "Avatar",
  "Badge",
  "Button",
  "Card",
  "CardContent",
  "CardHeader",
  "Checkbox",
  "CheckboxField",
  "CheckboxGroup",
  "CodeBlock",
  "Collapsible",
  "CollapsibleContent",
  "CollapsibleTrigger",
  "ColorModeProvider",
  "ColorModeScript",
  "ColorModeToggle",
  "Command",
  "CommandDialog",
  "CommandEmpty",
  "CommandGroup",
  "CommandInput",
  "CommandItem",
  "CommandItemContent",
  "CommandItemDescription",
  "CommandItemTitle",
  "CommandList",
  "CommandSeparator",
  "CommandShortcut",
  "DesignTokenStyle",
  "Dialog",
  "DialogAction",
  "DialogBody",
  "DialogCancel",
  "DialogClose",
  "DialogContent",
  "DialogDescription",
  "DialogFooter",
  "DialogForm",
  "DialogHeader",
  "DialogTitle",
  "DialogTrigger",
  "Drawer",
  "DrawerBody",
  "DrawerClose",
  "DrawerContent",
  "DrawerFooter",
  "DrawerHeader",
  "DrawerTitle",
  "DrawerTrigger",
  "DropdownMenu",
  "DropdownMenuContent",
  "DropdownMenuGroup",
  "DropdownMenuItem",
  "DropdownMenuItemMeta",
  "DropdownMenuLabel",
  "DropdownMenuSeparator",
  "DropdownMenuTrigger",
  "FileType",
  "FileTypeThumb",
  "IconButton",
  "Input",
  "Label",
  "List",
  "ListItem",
  "ListLabel",
  "LoadingButton",
  "Pill",
  "Popover",
  "PopoverActions",
  "PopoverBody",
  "PopoverContent",
  "PopoverFooter",
  "PopoverHeader",
  "PopoverTitle",
  "PopoverTrigger",
  "ProgressBar",
  "Radio",
  "RadioField",
  "RadioGroup",
  "ScrollFade",
  "Select",
  "SelectContent",
  "SelectGroup",
  "SelectItem",
  "SelectLabel",
  "SelectSeparator",
  "SelectTrigger",
  "SelectValue",
  "Shimmer",
  "Skeleton",
  "Slot",
  "Status",
  "Switch",
  "SwitchField",
  "Tabs",
  "TabsItem",
  "Tag",
  "TagButton",
  "TagGroup",
  "TagLink",
  "Textarea",
  "Tooltip",
  "TooltipContent",
  "TooltipProvider",
  "TooltipTrigger",
  "badgeVariants",
  "buttonVariants",
  "cva",
  "cx",
  "generateTokenCSS",
  "getDocumentNonce",
  "getFileTypeLabel",
  "inputVariants",
  "labelVariants",
  "pillVariants",
  "selectTriggerVariants",
  "switchTrackVariants",
  "textareaVariants",
  "useAppShell",
  "useColorMode",
  "useColorModeOptional",
];

describe("react/components/ui/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/ui", () => {
    assertEquals(Object.keys(uiModule).sort(), expectedRuntimeExports);
  });

  it("keeps re-exports wired to their source modules", () => {
    assertEquals(uiModule.ColorModeProvider, colorModeModule.ColorModeProvider);
    assertEquals(uiModule.useColorMode, colorModeModule.useColorMode);
    assertEquals(
      uiModule.useColorModeOptional,
      colorModeModule.useColorModeOptional,
    );
    assertEquals(uiModule.cva, cvaModule.cva);
    assertEquals(uiModule.cx, cvaModule.cx);
  });

  it("exposes the foundational primitives as callable components", () => {
    for (const name of ["Button", "Card", "Input", "Dialog", "Tabs"] as const) {
      assert(
        typeof uiModule[name] === "function" ||
          typeof uiModule[name] === "object",
        `${name} should be a component`,
      );
    }
  });
});
