/**
 * IconButton — ported 1:1 from Veryfront Studio: an icon-only Button with a
 * built-in Tooltip. Uses the basic Tooltip (a11y deferred — see tooltip.tsx).
 * Private to the chat module.
 *
 * @module react/components/chat/ui/icon-button
 */
import * as React from "react";
import { Button, type ButtonProps } from "./button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

/** Props accepted by `<IconButton>`. */
export interface IconButtonProps extends ButtonProps {
  /** Hover label. */
  tooltip: string;
  /** Tooltip side. @default "bottom" */
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

/** Render an icon-only button with a hover tooltip. */
export function IconButton({
  tooltip,
  tooltipSide = "bottom",
  disabled,
  size = "icon-default",
  ...props
}: IconButtonProps): React.ReactElement {
  if (disabled) {
    return <Button disabled size={size} {...props} />;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size={size} {...props} />
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
