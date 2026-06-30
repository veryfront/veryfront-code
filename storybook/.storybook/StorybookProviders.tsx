import * as React from "react";

/**
 * Provider tree re-applied inside `DocsExampleAuto` so a story rendered by a
 * direct `story.render()` call inherits the same surface chrome as a
 * Storybook-mounted story.
 *
 * Studio's version mounts app-level providers (Vike page context, project
 * store, tooltip, next-themes, …) that are all banned here. This repo's
 * stories don't need them — the only thing a Storybook-mounted story gets
 * beyond raw render is `preview.tsx`'s `withTheme` (sets `[data-theme]` on
 * `<html>`) and `withVeryfrontSurface` (the `.vf-story-shell` wrapper). The
 * theme attribute is already owned by the docs page that hosts the preview, so
 * here we only need to mirror the surface wrapper so direct renders look
 * identical to mounted ones.
 */
export function StorybookProviders(
  { children }: { children: React.ReactNode },
): React.ReactElement {
  return <div className="vf-story-shell">{children}</div>;
}
