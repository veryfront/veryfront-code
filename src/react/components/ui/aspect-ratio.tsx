/**
 * AspectRatio — constrains its content to a fixed width/height ratio. Pure-visual
 * CSS primitive (no engine needed): sets the `aspect-ratio` on a single node and
 * lets the child fill it. Handy for media, embeds, and skeleton placeholders.
 *
 * @module react/components/ui/aspect-ratio
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<AspectRatio>`. */
export interface AspectRatioProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width ÷ height (e.g. `16 / 9`, `1`, `4 / 3`). @default 1 */
  ratio?: number;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Constrain content to a fixed aspect ratio. */
export function AspectRatio({
  className,
  ratio = 1,
  style,
  ref,
  ...props
}: AspectRatioProps): React.ReactElement {
  return (
    <div
      ref={ref}
      data-orientation={ratio >= 1 ? "landscape" : "portrait"}
      className={cn("relative w-full overflow-hidden", className)}
      style={{ aspectRatio: String(ratio), ...style }}
      {...props}
    />
  );
}
