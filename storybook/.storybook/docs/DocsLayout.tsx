import type * as React from "react";
import { cn } from "./cn";

/** Root wrapper for component documentation pages. Provides consistent spacing.
 *
 *  Wraps content in `sb-unstyled` so docs primitives (DocsHero, DocsSection,
 *  DocsCode, etc.) and any author-supplied JSX render under their own
 *  Tailwind classes instead of being clobbered by the docs prose cascade.
 *  Every docs page needs this; baking it into DocsPage removes the per-MDX
 *  manual wrapper that drove silent visual drift between pages. */
export function DocsPage(
  { children, className }: { children: React.ReactNode; className?: string },
) {
  return (
    <div className={cn("bg-background text-foreground min-h-screen", className)}>
      <div className="sb-unstyled max-w-5xl mx-auto px-3 sm:px-8">
        {children}
      </div>
    </div>
  );
}
