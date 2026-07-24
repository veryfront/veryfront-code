---
title: "veryfront/ui"
description: "`veryfront/ui` - the public UI primitive library. Dependency-light forks of Veryfront Studio's design system (cva/Slot inlined; colours remapped to veryfront's `[var(--token)]` vocabulary; zero external packages). These are the base layer the `veryfront/chat` components are built on: `chat` depends on `ui`, never the reverse."
order: 35
---

## Import

```ts
import {
  cva,
  generateTokenCSS,
  getDocumentNonce,
  getFileTypeLabel,
  useColorModeOptional,
  Alert,
} from "veryfront/ui";
```

## Examples

### Compose primitives

```tsx
import { Button, Card, CardHeader, CardContent } from "veryfront/ui";

export function Panel() {
  return (
    <Card>
      <CardHeader>Settings</CardHeader>
      <CardContent>
        <Button onClick={() => save()}>Save</Button>
      </CardContent>
    </Card>
  );
}
```

### Light/dark mode

```tsx
import { ColorModeProvider, ColorModeToggle } from "veryfront/ui";

export default function App({ children }: { children: React.ReactNode }) {
  return (
    <ColorModeProvider>
      <ColorModeToggle />
      {children}
    </ColorModeProvider>
  );
}
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `Alert` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/alert.tsx#L28) |
| `AlertAction` | Trailing action slot for `<Alert>` (button or link). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/alert.tsx#L89) |
| `AlertContent` | Message body for `<Alert>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/alert.tsx#L70) |
| `AlertIcon` | Leading icon slot for `<Alert>` (size-4 recommended). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/alert.tsx#L51) |
| `AppShell` | Compound AppShell. Compose: | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L529) |
| `Avatar` | Render a user / agent / entity avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/avatar.tsx#L37) |
| `Badge` | Render a badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/badge.tsx#L38) |
| `Button` | Render an action button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/button.tsx#L126) |
| `Card` | A flat card surface (Studio `Card`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/card.tsx#L50) |
| `CardContent` | Card body region - vertical stack. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/card.tsx#L77) |
| `CardHeader` | Card header row - a flex row (Studio composes these inline). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/card.tsx#L64) |
| `Checkbox` | A checkbox with an overlaid check indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/checkbox.tsx#L23) |
| `CheckboxField` | A checkbox paired with a clickable label and optional description. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/checkbox.tsx#L62) |
| `CheckboxGroup` | Vertical group of checkboxes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/checkbox.tsx#L91) |
| `CodeBlock` | Render a syntax-highlighted code block (or a mermaid diagram). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L438) |
| `Collapsible` | Collapsible root - owns open state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/collapsible.tsx#L29) |
| `CollapsibleContent` | Collapsible content - rendered only while open. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/collapsible.tsx#L80) |
| `CollapsibleTrigger` | Toggles the collapsible. `asChild` merges onto the child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/collapsible.tsx#L54) |
| `ColorModeProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/color-mode.tsx#L47) |
| `ColorModeScript` | Inline script to prevent flash of wrong color mode on SSR. Render this in <head> before any content. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/color-mode.tsx#L127) |
| `ColorModeToggle` | Simple toggle button for color mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/color-mode.tsx#L149) |
| `Command` | Command root - owns the filter query and the item registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L35) |
| `CommandDialog` | A Command palette inside a modal Dialog overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L94) |
| `CommandEmpty` | Shown when the query matches no items. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L173) |
| `CommandGroup` | A labelled group of items; auto-hides when all its items are filtered out. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L191) |
| `CommandInput` | Search input row - bound to the command's filter query. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L117) |
| `CommandItem` | A selectable, filterable result row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L233) |
| `CommandItemContent` | Flex column wrapper for an item's title + description. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L279) |
| `CommandItemDescription` | Item secondary text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L293) |
| `CommandItemTitle` | Item primary text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L286) |
| `CommandList` | Scrollable results list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L155) |
| `CommandSeparator` | Divider between groups. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L216) |
| `CommandShortcut` | Trailing shortcut / metadata text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L305) |
| `DesignTokenStyle` | Scoped design-token stylesheet. Idempotent - render it anywhere. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tokens.tsx#L23) |
| `Dialog` | Dialog root - owns open state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L35) |
| `DialogAction` | Recommended action button (primary, default size). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L143) |
| `DialogBody` | Scrollable body area with a bottom edge-fade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L107) |
| `DialogCancel` | Alternate button (secondary, default size) that closes the dialog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L162) |
| `DialogClose` | Closes the dialog. `asChild` merges onto the child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L185) |
| `DialogContent` | Modal surface - overlay + centered panel, rendered while open. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L47) |
| `DialogDescription` | Dialog description - body text, left-aligned. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L91) |
| `DialogFooter` | Sticky footer row - action left, cancel right. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L124) |
| `DialogForm` | Layout-neutral `<form>` shell (`display: contents`) wrapping header/body/footer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L131) |
| `DialogHeader` | Left-aligned title + description block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L67) |
| `DialogTitle` | Dialog title - Studio Heading level 2 (20px). Semibold so Inter reads at Studio's medium-on-Söhne weight (workbench heading convention). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L75) |
| `DialogTrigger` | Trigger - opens the dialog. `asChild` merges onto the child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L40) |
| `Drawer` | Drawer root - owns open state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L29) |
| `DrawerBody` | Scrollable body area. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L86) |
| `DrawerClose` | Closes the drawer. `asChild` merges onto the child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L113) |
| `DrawerContent` | Bottom sheet - overlay + sliding surface with a drag handle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L41) |
| `DrawerFooter` | Sticky footer, full-width stacked actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L98) |
| `DrawerHeader` | Header column wrapper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L79) |
| `DrawerTitle` | Drawer title - 18px medium (Studio Heading-ish). Add `sr-only` to hide. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L66) |
| `DrawerTrigger` | Trigger - opens the drawer. `asChild` merges onto the child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L34) |
| `DropdownMenu` | DropdownMenu root - owns open state and the positioning anchor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L30) |
| `DropdownMenuContent` | Menu surface - rendered below the trigger while open. No border (Studio). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L48) |
| `DropdownMenuGroup` | Groups related items with a tight inner gap (Studio: `gap-px p-0.5`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L67) |
| `DropdownMenuItem` | A selectable menu item. Icons render at `size-3.5` (14px). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L86) |
| `DropdownMenuItemMeta` | Trailing metadata text - keyboard shortcuts, counts, badges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L122) |
| `DropdownMenuLabel` | Non-interactive section label - full-strength foreground (Studio). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L149) |
| `DropdownMenuSeparator` | Full-width divider between groups (Studio: `-mx-2.5 my-2`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L142) |
| `DropdownMenuTrigger` | Trigger - toggles the menu. `asChild` merges onto the child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L35) |
| `FileType` | Soft-fill badge - rounded square, tinted background, extension label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/file-type.tsx#L245) |
| `FileTypeThumb` | Solid-fill thumbnail - full-saturation square with white `.ext` text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/file-type.tsx#L266) |
| `IconButton` | Render an icon-only button with a hover tooltip. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icon-button.tsx#L21) |
| `Input` | Render a text input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/input.tsx#L46) |
| `Label` | Render a form label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/label.tsx#L48) |
| `List` | Vertical list container. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/list.tsx#L25) |
| `ListItem` | A single list row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/list.tsx#L67) |
| `ListLabel` | Section heading - uppercase, faint. Use for date groups etc. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/list.tsx#L35) |
| `LoadingButton` | Button that pulses subtly while pending and blocks double-submits. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/button.tsx#L160) |
| `Pill` | Render a selection-trigger pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/pill.tsx#L49) |
| `Popover` | Popover root - owns open state and the positioning anchor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L29) |
| `PopoverActions` | Right-aligned button row, for use inside a footer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L135) |
| `PopoverBody` | Body content region (Studio: `px-5 last:pb-5 flex flex-col gap-4`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L104) |
| `PopoverContent` | Popover surface - rendered below the trigger while open. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L47) |
| `PopoverFooter` | Footer region; pass `bordered` for a top divider (Studio). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L117) |
| `PopoverHeader` | Small section label inside a popover (Studio: Heading level 5). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L85) |
| `PopoverTitle` | Primary heading slot at the top of a popover (Studio: Heading level 4). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L66) |
| `PopoverTrigger` | Trigger - toggles the popover. `asChild` merges onto the child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L34) |
| `ProgressBar` | Render a progress track. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/progress-bar.tsx#L38) |
| `Radio` | A single radio input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/radio.tsx#L19) |
| `RadioField` | A radio paired with a clickable label and optional description. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/radio.tsx#L47) |
| `RadioGroup` | Vertical group of radios. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/radio.tsx#L76) |
| `ScrollFade` | A scroll container with auto edge-fade affordances. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/scroll-fade.tsx#L31) |
| `Select` | Select root - owns the selected value, open state, and label registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L69) |
| `SelectContent` | Listbox surface - rendered below the trigger while open. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L188) |
| `SelectGroup` | Groups related options (semantic only in this basic version). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L282) |
| `SelectItem` | A selectable option. Shows a check when it is the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L221) |
| `SelectLabel` | Non-interactive section label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L260) |
| `SelectSeparator` | Divider between option groups. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L275) |
| `SelectTrigger` | Trigger - shows the current value and toggles the listbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L147) |
| `SelectValue` | Displays the selected option's label, or a placeholder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L175) |
| `Shimmer` | Render shimmering text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/shimmer.tsx#L27) |
| `Skeleton` | Render an animated placeholder bar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/skeleton.tsx#L16) |
| `Slot` | Render `Slot` - merge props onto its single child element. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/slot.tsx#L70) |
| `Status` | Render a status dot + label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/status.tsx#L39) |
| `Switch` | A toggle switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/switch.tsx#L59) |
| `SwitchField` | A switch with a label + optional description, label-left / switch-right. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/switch.tsx#L92) |
| `Tabs` | Tablist container - manages active state and passes context to items. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L42) |
| `TabsItem` | Individual tab - renders as a button, or an anchor when `href` is set. Forwards native props/ref and composes the caller's `onClick` with the internal selection (caller's runs first, then the tab activates), so a consumer-supplied handler adds to - never overrides - selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L81) |
| `Tag` | Static metadata chip. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tag.tsx#L16) |
| `TagButton` | Tag rendered as a button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tag.tsx#L50) |
| `TagGroup` | Wrapping container for a row of tags. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tag.tsx#L67) |
| `TagLink` | Tag rendered as an external link. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tag.tsx#L32) |
| `Textarea` | Render a textarea. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/textarea.tsx#L43) |
| `Tooltip` | Tooltip root - owns open state and the positioning anchor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tooltip.tsx#L36) |
| `TooltipContent` | Tooltip content - portalled + positioned while hovered/focused. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tooltip.tsx#L135) |
| `TooltipProvider` | Provider for shared tooltip config. Basic: a passthrough for API parity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tooltip.tsx#L29) |
| `TooltipTrigger` | Tooltip trigger. `asChild` merges onto the child element (e.g. a Button). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tooltip.tsx#L58) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `cva` | Build a class-name function from a base plus a variants config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/cva.ts#L45) |
| `generateTokenCSS` | Generates the scoped CSS for the design tokens. Every rule matches BOTH the canonical `[data-vf-ui]` scope and the `[data-vf-chat]` compat alias, so tokens don't leak to the page and existing consumers keep working. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/design-tokens.ts#L184) |
| `getDocumentNonce` | Reuse the server-issued CSP nonce for client-created style/script elements during hydration and SPA updates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/csp-nonce.ts#L5) |
| `getFileTypeLabel` | Human label for a file extension, falling back to the media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/file-type.tsx#L233) |
| `useColorModeOptional` | Non-throwing variant - returns `null` when there is no `ColorModeProvider`. Use for components that should render standalone (e.g. a `CodeBlock` dropped into markdown) and fall back to light mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/color-mode.tsx#L117) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AlertProps` | Props accepted by `<Alert>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/alert.tsx#L23) |
| `AppShellHeaderProps` | Props accepted by `AppShellHeader`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L434) |
| `AppShellOpenState` | Per-side visibility map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L94) |
| `AppShellProps` | Props accepted by `AppShell`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L100) |
| `AppShellSide` | Which edge a sidebar docks to. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L29) |
| `AppShellSidebarProps` | Props accepted by `AppShellSidebar`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L230) |
| `AppShellTriggerProps` | Props accepted by `AppShellTrigger`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L466) |
| `AvatarProps` | Props accepted by `<Avatar>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/avatar.tsx#L25) |
| `BadgeProps` | Props accepted by `<Badge>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/badge.tsx#L32) |
| `ButtonProps` | Props accepted by `<Button>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/button.tsx#L116) |
| `CardProps` | Props accepted by `<Card>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/card.tsx#L44) |
| `CheckboxFieldProps` | Props accepted by `<CheckboxField>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/checkbox.tsx#L56) |
| `CheckboxProps` | Props accepted by `<Checkbox>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/checkbox.tsx#L16) |
| `CodeBlockProps` | Props accepted by `<CodeBlock>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L237) |
| `CollapsibleProps` | Props accepted by `<Collapsible>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/collapsible.tsx#L21) |
| `ColorModeProviderProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/color-mode.tsx#L40) |
| `CommandDialogProps` | Props accepted by `<CommandDialog>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L86) |
| `CommandInputProps` | Props accepted by `<CommandInput>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L111) |
| `CommandItemProps` | Props accepted by `<CommandItem>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/command.tsx#L223) |
| `DialogActionProps` | Props accepted by `<DialogAction>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L138) |
| `DialogProps` | Props accepted by `<Dialog>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dialog.tsx#L27) |
| `DrawerProps` | Props accepted by `<Drawer>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/drawer.tsx#L21) |
| `DropdownMenuContentProps` | Props accepted by `<DropdownMenuContent>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L42) |
| `DropdownMenuItemProps` | Props accepted by `<DropdownMenuItem>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L78) |
| `DropdownMenuProps` | Props accepted by `<DropdownMenu>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/dropdown-menu.tsx#L22) |
| `FileTypeProps` | Props accepted by `<FileType>` / `<FileTypeThumb>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/file-type.tsx#L239) |
| `IconButtonProps` | Props accepted by `<IconButton>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icon-button.tsx#L13) |
| `InputProps` | Props accepted by `<Input>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/input.tsx#L37) |
| `LabelProps` | Props accepted by `<Label>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/label.tsx#L42) |
| `ListItemProps` | Props accepted by `ListItem`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/list.tsx#L51) |
| `ListLabelProps` | Props accepted by `ListLabel`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/list.tsx#L30) |
| `ListProps` | Props accepted by `List`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/list.tsx#L20) |
| `PillProps` | Props accepted by `<Pill>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/pill.tsx#L41) |
| `PopoverContentProps` | Props accepted by `<PopoverContent>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L41) |
| `PopoverProps` | Props accepted by `<Popover>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/popover.tsx#L21) |
| `ProgressBarProps` | Props accepted by `<ProgressBar>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/progress-bar.tsx#L30) |
| `RadioFieldProps` | Props accepted by `<RadioField>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/radio.tsx#L41) |
| `RadioProps` | Props accepted by `<Radio>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/radio.tsx#L14) |
| `ScrollFadeProps` | Props accepted by `<ScrollFade>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/scroll-fade.tsx#L21) |
| `SelectItemProps` | Props accepted by `<SelectItem>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L215) |
| `SelectProps` | Props accepted by `<Select>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L58) |
| `SelectTriggerProps` | Props accepted by `<SelectTrigger>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L141) |
| `ShimmerProps` | Props accepted by `<Shimmer>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/shimmer.tsx#L15) |
| `SkeletonProps` | Props accepted by `<Skeleton>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/skeleton.tsx#L11) |
| `SlotProps` | Props accepted by `<Slot>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/slot.tsx#L65) |
| `StatusColor` | Dot colour, keyed to the `--status-*` palette. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/status.tsx#L13) |
| `StatusProps` | Props accepted by `<Status>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/status.tsx#L16) |
| `SwitchFieldProps` | Props accepted by `<SwitchField>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/switch.tsx#L86) |
| `SwitchProps` | Props accepted by `<Switch>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/switch.tsx#L49) |
| `TabsItemProps` | Props accepted by `<TabsItem>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L68) |
| `TabsProps` | Props accepted by `<Tabs>` (the tablist container). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L34) |
| `TagLinkProps` | Props accepted by `<TagLink>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tag.tsx#L27) |
| `TextareaProps` | Props accepted by `<Textarea>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/textarea.tsx#L37) |
| `TooltipContentProps` | Props accepted by `<TooltipContent>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tooltip.tsx#L129) |
| `VariantProps` | Extracts the variant props of a `cva` function, like upstream's helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/cva.ts#L36) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `badgeVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/badge.tsx#L13) |
| `buttonVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/button.tsx#L20) |
| `cx` | Re-export of the class joiner, matching upstream's `cx`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/cva.ts#L13) |
| `inputVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/input.tsx#L13) |
| `labelVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/label.tsx#L17) |
| `pillVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/pill.tsx#L15) |
| `selectTriggerVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/select.tsx#L21) |
| `switchTrackVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/switch.tsx#L15) |
| `textareaVariants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/textarea.tsx#L11) |
| `useAppShell` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L47) |
| `useColorMode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/color-mode.tsx#L23) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/ui/icons`

Ai - Icons

```ts
import { AlertTriangleIcon, ArrowDownIcon, ArrowRightIcon } from "veryfront/ui/icons";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AlertTriangleIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L214) |
| `ArrowDownIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L240) |
| `ArrowRightIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L329) |
| `ArrowUpIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L338) |
| `BrainIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L230) |
| `CheckCircleIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L206) |
| `CheckIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L264) |
| `ChevronDownIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L226) |
| `CircleIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L198) |
| `ClockIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L202) |
| `CodeBracketsIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L400) |
| `CopyIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L256) |
| `FileTextIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L408) |
| `InfoIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L210) |
| `MessageSquareIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L234) |
| `MoreHorizontalIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L354) |
| `PanelLeftIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L346) |
| `PanelRightIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L350) |
| `PaperclipIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L260) |
| `PencilIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L360) |
| `PlusIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L302) |
| `RefreshCwIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L252) |
| `SearchIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L311) |
| `SendIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L244) |
| `SparklesIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L377) |
| `StopIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L248) |
| `TargetIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L404) |
| `TrashIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L342) |
| `WrenchIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L222) |
| `XCircleIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L218) |
| `XIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L320) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `IconProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/icons/index.ts#L10) |
