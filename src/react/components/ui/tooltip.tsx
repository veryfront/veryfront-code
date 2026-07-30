/**
 * Tooltip — API-compatible with Studio's (Radix-shaped: `TooltipProvider` /
 * `Tooltip` / `TooltipTrigger` / `TooltipContent`). Hover/focus opens it.
 *
 * The behavioural mechanics (open state, collision-aware positioning, portal
 * into the token scope, arrow) resolve per-render from the active UI adapter.
 * With no adapter provider this is the zero-dependency `builtinTooltip`, so
 * behaviour is unchanged; an app may swap in a Base UI / React Aria tooltip
 * without touching this skin or any call-site.
 *
 * @example
 * ```tsx
 * import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "veryfront/ui";
 *
 * <TooltipProvider>
 *   <Tooltip>
 *     <TooltipTrigger asChild><Button>Save</Button></TooltipTrigger>
 *     <TooltipContent>Save changes (⌘S)</TooltipContent>
 *   </Tooltip>
 * </TooltipProvider>;
 * ```
 *
 * @module react/components/ui/tooltip
 */
import * as React from "react";
import { useAdapter } from "./adapter/context.tsx";
import type { TooltipSide } from "./adapter/contract.ts";

/** Provider for shared tooltip config. Basic: a passthrough for API parity. */
export function TooltipProvider(
  props: { children: React.ReactNode; delayDuration?: number },
): React.ReactElement {
  const { tooltip } = useAdapter();
  return <tooltip.Provider {...props} />;
}

/** Tooltip root — owns open state and the positioning anchor. */
export function Tooltip(
  props: { children: React.ReactNode },
): React.ReactElement {
  const { tooltip } = useAdapter();
  return <tooltip.Root {...props} />;
}

/** Tooltip trigger. `asChild` merges onto the child element (e.g. a Button). */
export function TooltipTrigger(
  props:
    & React.HTMLAttributes<HTMLElement>
    & { children: React.ReactNode; asChild?: boolean },
): React.ReactElement {
  const { tooltip } = useAdapter();
  return <tooltip.Trigger {...props} />;
}

/** Props accepted by `<TooltipContent>`. */
export interface TooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Side of the trigger to place the tooltip. @default "top" */
  side?: TooltipSide;
  /** Gap in pixels between the trigger and the tooltip. */
  sideOffset?: number;
}

/** Tooltip content — portalled + positioned while hovered/focused. */
export function TooltipContent(
  props: TooltipContentProps,
): React.ReactElement | null {
  const { tooltip } = useAdapter();
  return <tooltip.Content {...props} />;
}
