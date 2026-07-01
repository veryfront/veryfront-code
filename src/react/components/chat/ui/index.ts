/**
 * Private UI primitives for the chat component library — forked from Veryfront
 * Studio with zero external dependencies (cva/Slot inlined; colours remapped to
 * veryfront's `[var(--token)]` vocabulary). NOT a public export: this barrel is
 * internal to `veryfront/chat` and is intentionally absent from the chat index.
 *
 * @module react/components/chat/ui
 */
export { cva, cx, type VariantProps } from "./cva.ts";
export { Slot, type SlotProps } from "./slot.tsx";
export { Button, type ButtonProps, buttonVariants, LoadingButton } from "./button.tsx";
export { Badge, type BadgeProps, badgeVariants } from "./badge.tsx";
export { Card, CardContent, CardHeader, type CardProps } from "./card.tsx";
export { Pill, type PillProps, pillVariants } from "./pill.tsx";
export { Tag, TagButton, TagGroup, TagLink, type TagLinkProps } from "./tag.tsx";
export { Status, type StatusColor, type StatusProps } from "./status.tsx";
export { Label, type LabelProps, labelVariants } from "./label.tsx";
export { Skeleton, type SkeletonProps } from "./skeleton.tsx";
export { Shimmer, type ShimmerProps } from "./shimmer.tsx";
export { ProgressBar, type ProgressBarProps } from "./progress-bar.tsx";
export { FileType, type FileTypeProps, FileTypeThumb, getFileTypeLabel } from "./file-type.tsx";
export { Textarea, type TextareaProps, textareaVariants } from "./textarea.tsx";
export {
  Tooltip,
  TooltipContent,
  type TooltipContentProps,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.tsx";
export { IconButton, type IconButtonProps } from "./icon-button.tsx";
export {
  Collapsible,
  CollapsibleContent,
  type CollapsibleProps,
  CollapsibleTrigger,
} from "./collapsible.tsx";
export { Input, type InputProps, inputVariants } from "./input.tsx";
export { Avatar, type AvatarProps } from "./avatar.tsx";
export { Alert, AlertAction, AlertContent, AlertIcon, type AlertProps } from "./alert.tsx";
export { CodeBlock, type CodeBlockProps } from "./code-block.tsx";
export {
  DropdownMenu,
  DropdownMenuContent,
  type DropdownMenuContentProps,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemMeta,
  type DropdownMenuItemProps,
  DropdownMenuLabel,
  type DropdownMenuProps,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";
export {
  Checkbox,
  CheckboxField,
  type CheckboxFieldProps,
  CheckboxGroup,
  type CheckboxProps,
} from "./checkbox.tsx";
export { Radio, RadioField, type RadioFieldProps, RadioGroup, type RadioProps } from "./radio.tsx";
export {
  Switch,
  SwitchField,
  type SwitchFieldProps,
  type SwitchProps,
  switchTrackVariants,
} from "./switch.tsx";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  type SelectItemProps,
  SelectLabel,
  type SelectProps,
  SelectSeparator,
  SelectTrigger,
  type SelectTriggerProps,
  selectTriggerVariants,
  SelectValue,
} from "./select.tsx";
export { ScrollFade, type ScrollFadeProps } from "./scroll-fade.tsx";
export { Tabs, type TabsItemProps, type TabsRootProps } from "./tabs.tsx";
export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  type DrawerProps,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer.tsx";
export {
  Dialog,
  DialogAction,
  type DialogActionProps,
  DialogBody,
  DialogCancel,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  type DialogProps,
  DialogTitle,
  DialogTrigger,
} from "./dialog.tsx";
export {
  Command,
  CommandDialog,
  type CommandDialogProps,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  type CommandInputProps,
  CommandItem,
  CommandItemContent,
  CommandItemDescription,
  type CommandItemProps,
  CommandItemTitle,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command.tsx";
export {
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  type PopoverContentProps,
  PopoverFooter,
  PopoverHeader,
  type PopoverProps,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.tsx";
