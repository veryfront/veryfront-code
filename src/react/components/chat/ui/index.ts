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
export { Label, type LabelProps, labelVariants } from "./label.tsx";
export { Skeleton, type SkeletonProps } from "./skeleton.tsx";
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
export { UserAvatar, type UserAvatarProps } from "./user-avatar.tsx";
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
