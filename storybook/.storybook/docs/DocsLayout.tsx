import * as React from "react";
import { useGlobals } from "storybook/internal/preview-api";
import { cn } from "./cn";

/** Syncs the toolbar theme global to `<html data-theme>`. The `withTheme`
 *  decorator only runs for canvas stories; docs-page previews render via a
 *  direct call (see `DocsAutodocsExample`), so decorators never fire and the
 *  Dark Mode toggle wouldn't apply on docs pages. This mirrors that decorator
 *  from inside the docs page so Components/Composition/UI honour the toggle. */
function ThemeSync(): null {
  const [globals] = useGlobals();
  const theme = globals?.theme === "dark" ? "dark" : "light";
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return null;
}

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
      <ThemeSync />
      <div className="sb-unstyled max-w-5xl mx-auto px-3 sm:px-8">
        {children}
      </div>
    </div>
  );
}
