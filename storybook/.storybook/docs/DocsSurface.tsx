import * as React from "react";
import { cn } from "./cn";

/**
 * The canonical bordered surface used across every Storybook docs primitive —
 * DocsCode, DocsExample, DocsExampleAuto, DocsComposition, DocsPropsTable,
 * and the prose <table> / <blockquote> renderers in markdown.tsx.
 *
 * Owns the rounded / border / bg / overflow / margin / sb-unstyled decisions
 * so they live in one place. Any visual change to the docs surface happens
 * here — never at consumers.
 *
 * Per DESIGN.md: rounded-md (12px), border-outline-border, optional bg-card.
 */
export interface DocsSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Apply the card fill (bg-card). Defaults to true. Set to false on surfaces whose inner panes own their own backgrounds. */
  filled?: boolean;
  /** Apply the standard docs bottom margin (mb-6). Defaults to true. */
  spaced?: boolean;
}

export function DocsSurface(
  { filled = true, spaced = true, className, ...props }: DocsSurfaceProps,
) {
  return (
    <div
      className={cn(
        "sb-unstyled rounded-md border border-outline-border overflow-hidden",
        spaced && "mb-6",
        filled && "bg-card",
        className,
      )}
      {...props}
    />
  );
}
