/**
 * ToggleGroup: a set of {@link Toggle}-style buttons with shared selection.
 * `type="single"` behaves like a segmented control (one value, optionally
 * deselectable); `type="multiple"` is a set of independent toggles (an array of
 * values). Selection is exposed as `data-state="on" | "off"` per item; skinned
 * with the veryfront theme tokens.
 *
 * The selection MECHANICS come from the active adapter's `toggleGroup` slot
 * (`useAdapter().toggleGroup`): zero-dependency builtin by default, swappable
 * via `UIAdapterProvider`. This file owns only the API shape + the item's visual
 * classes; the adapter drives selection + `aria-pressed` / `data-state`.
 *
 * @module react/components/ui/toggle-group
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";
import type {
  MultipleToggleGroupRootProps,
  SingleToggleGroupRootProps,
} from "./adapter/contract.ts";

/** Props accepted by `<ToggleGroup>`. */
export type ToggleGroupProps = SingleToggleGroupRootProps | MultipleToggleGroupRootProps;

/** Render a group of toggles with shared selection (via the adapter engine). */
export function ToggleGroup(
  { className, children, ...props }: ToggleGroupProps,
): React.ReactElement {
  const { toggleGroup } = useAdapter();
  return (
    <toggleGroup.Root className={cn("inline-flex items-center gap-1", className)} {...props}>
      {children}
    </toggleGroup.Root>
  );
}

/** Props accepted by `<ToggleGroupItem>`. */
export interface ToggleGroupItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  /** The value this item contributes to the group selection. */
  value: string;
  /** Render as a Slot, merging the item behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** A single toggle within a {@link ToggleGroup}. */
export function ToggleGroupItem(
  { className, ...props }: ToggleGroupItemProps,
): React.ReactElement {
  const { toggleGroup } = useAdapter();
  return (
    <toggleGroup.Item
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md",
        "h-[38px] min-w-[38px] px-3 text-base font-normal",
        "transition-[background-color,color] duration-150 ease-in",
        "text-[var(--foreground)] hover:bg-[var(--accent)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        "data-[state=on]:bg-[var(--secondary)] data-[state=on]:text-[var(--foreground)]",
        "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}
