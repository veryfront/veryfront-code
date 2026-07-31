/**
 * `veryfront/ui` — the public UI primitive library. Dependency-light forks of
 * Veryfront Studio's design system (cva/Slot inlined; colours remapped to
 * veryfront's `[var(--token)]` vocabulary; zero external packages). These are
 * the base layer the `veryfront/chat` components are built on: `chat` depends on
 * `ui`, never the reverse.
 *
 * @module react/components/ui
 *
 * @example Compose primitives
 * ```tsx
 * import { Button, Card, CardHeader, CardContent } from "veryfront/ui";
 *
 * export function Panel() {
 *   return (
 *     <Card>
 *       <CardHeader>Settings</CardHeader>
 *       <CardContent>
 *         <Button onClick={() => save()}>Save</Button>
 *       </CardContent>
 *     </Card>
 *   );
 * }
 * ```
 *
 * @example Light/dark mode
 * ```tsx
 * import { ColorModeProvider, ColorModeToggle } from "veryfront/ui";
 *
 * export default function App({ children }: { children: React.ReactNode }) {
 *   return (
 *     <ColorModeProvider>
 *       <ColorModeToggle />
 *       {children}
 *     </ColorModeProvider>
 *   );
 * }
 * ```
 */
export { cva, cx, type VariantProps } from "./cva.ts";
export { generateTokenCSS } from "./design-tokens.ts";
export { DesignTokenStyle } from "./tokens.tsx";
export { getDocumentNonce } from "./csp-nonce.ts";
export {
  ColorModeProvider,
  type ColorModeProviderProps,
  ColorModeScript,
  ColorModeToggle,
  useColorMode,
  useColorModeOptional,
} from "./color-mode.tsx";
export {
  AppShell,
  type AppShellHeaderProps,
  type AppShellOpenState,
  type AppShellProps,
  type AppShellSide,
  type AppShellSidebarProps,
  type AppShellTriggerProps,
  useAppShell,
} from "./app-shell.tsx";
export {
  List,
  ListItem,
  type ListItemProps,
  ListLabel,
  type ListLabelProps,
  type ListProps,
} from "./list.tsx";
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
export { Tabs, TabsItem, type TabsItemProps, type TabsProps } from "./tabs.tsx";
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
export {
  Accordion,
  AccordionContent,
  type AccordionContentProps,
  AccordionItem,
  type AccordionItemProps,
  type AccordionProps,
  AccordionTrigger,
  type AccordionTriggerProps,
} from "./accordion.tsx";
export { AspectRatio, type AspectRatioProps } from "./aspect-ratio.tsx";
export {
  Autocomplete,
  AutocompleteContent,
  type AutocompleteContentProps,
  AutocompleteInput,
  type AutocompleteInputProps,
  AutocompleteItem,
  type AutocompleteItemProps,
  type AutocompleteProps,
} from "./autocomplete.tsx";
export {
  HoverCard,
  HoverCardContent,
  type HoverCardContentProps,
  type HoverCardProps,
  HoverCardTrigger,
  type HoverCardTriggerProps,
} from "./hover-card.tsx";
export {
  Combobox,
  ComboboxContent,
  type ComboboxContentProps,
  ComboboxInput,
  type ComboboxInputProps,
  ComboboxItem,
  type ComboboxItemProps,
  type ComboboxProps,
} from "./combobox.tsx";
export {
  ContextMenu,
  ContextMenuContent,
  type ContextMenuContentProps,
  ContextMenuGroup,
  ContextMenuItem,
  type ContextMenuItemProps,
  ContextMenuLabel,
  type ContextMenuProps,
  ContextMenuSeparator,
  ContextMenuTrigger,
  type ContextMenuTriggerProps,
} from "./context-menu.tsx";
export {
  Menubar,
  MenubarContent,
  type MenubarContentProps,
  MenubarItem,
  type MenubarItemProps,
  MenubarMenu,
  type MenubarMenuProps,
  type MenubarProps,
  MenubarSeparator,
  type MenubarSeparatorProps,
  MenubarTrigger,
  type MenubarTriggerProps,
} from "./menubar.tsx";
export { NumberField, type NumberFieldProps } from "./number-field.tsx";
export {
  Toast,
  type ToastAction,
  ToastClose,
  ToastDescription,
  type ToastFn,
  type ToastOptions,
  type ToastProps,
  ToastProvider,
  type ToastProviderProps,
  ToastTitle,
  type ToastVariant,
  ToastViewport,
  ToastViewport as Toaster,
  type ToastViewportProps,
  useToast,
} from "./toast.tsx";
export { Separator, type SeparatorProps } from "./separator.tsx";
export { Slider, type SliderProps } from "./slider.tsx";
export { Toggle, type ToggleProps } from "./toggle.tsx";
export {
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupItemProps,
  type ToggleGroupProps,
} from "./toggle-group.tsx";
export { Meter, type MeterProps } from "./meter.tsx";
export { ScrollArea, type ScrollAreaProps, scrollAreaVariants } from "./scroll-area.tsx";
export { InputOTP, type InputOTPProps } from "./input-otp.tsx";
export {
  Breadcrumb,
  BreadcrumbEllipsis,
  type BreadcrumbEllipsisProps,
  BreadcrumbItem,
  type BreadcrumbItemProps,
  BreadcrumbLink,
  type BreadcrumbLinkProps,
  BreadcrumbList,
  type BreadcrumbListProps,
  BreadcrumbPage,
  type BreadcrumbPageProps,
  type BreadcrumbProps,
  BreadcrumbSeparator,
  type BreadcrumbSeparatorProps,
} from "./breadcrumb.tsx";
export {
  Pagination,
  PaginationContent,
  type PaginationContentProps,
  PaginationEllipsis,
  type PaginationEllipsisProps,
  PaginationItem,
  type PaginationItemProps,
  PaginationLink,
  type PaginationLinkProps,
  PaginationNext,
  type PaginationNextProps,
  PaginationPrevious,
  type PaginationPreviousProps,
  type PaginationProps,
} from "./pagination.tsx";
export {
  Field,
  FieldControl,
  type FieldControlProps,
  FieldDescription,
  type FieldDescriptionProps,
  FieldError,
  type FieldErrorProps,
  FieldLabel,
  type FieldLabelProps,
  type FieldProps,
} from "./field.tsx";
export { Calendar, type CalendarProps } from "./calendar.tsx";
export {
  DatePicker,
  DatePickerContent,
  type DatePickerContentProps,
  type DatePickerProps,
  DatePickerTrigger,
  type DatePickerTriggerProps,
} from "./date-picker.tsx";
export {
  AlertDialog,
  AlertDialogAction,
  type AlertDialogActionProps,
  AlertDialogCancel,
  type AlertDialogCancelProps,
  AlertDialogContent,
  type AlertDialogContentProps,
  AlertDialogDescription,
  type AlertDialogDescriptionProps,
  AlertDialogFooter,
  type AlertDialogFooterProps,
  type AlertDialogProps,
  AlertDialogTitle,
  type AlertDialogTitleProps,
  AlertDialogTrigger,
  type AlertDialogTriggerProps,
} from "./alert-dialog.tsx";
export {
  Toolbar,
  ToolbarButton,
  type ToolbarButtonProps,
  ToolbarLink,
  type ToolbarLinkProps,
  type ToolbarProps,
  ToolbarSeparator,
  type ToolbarSeparatorProps,
  toolbarVariants,
} from "./toolbar.tsx";
export {
  NavigationMenu,
  NavigationMenuContent,
  type NavigationMenuContentProps,
  NavigationMenuItem,
  type NavigationMenuItemProps,
  NavigationMenuLink,
  type NavigationMenuLinkProps,
  NavigationMenuList,
  type NavigationMenuListProps,
  type NavigationMenuProps,
  NavigationMenuTrigger,
  type NavigationMenuTriggerProps,
} from "./navigation-menu.tsx";
export { UIAdapterProvider, useAdapter } from "./adapter/context.tsx";
export { useTokenScope } from "./adapter/token-scope.tsx";
export type {
  ComboboxParts,
  ComboboxState,
  DialogParts,
  DisclosureParts,
  DisclosureProps,
  DrawerParts,
  MenuParts,
  ModalState,
  PartialUIAdapter,
  PopoverParts,
  SelectParts,
  SelectState,
  TabsParts,
  ToastParts,
  ToastState,
  ToggleGroupParts,
  ToolbarParts,
  TooltipParts,
  TooltipSide,
  UIAdapter,
} from "./adapter/contract.ts";
