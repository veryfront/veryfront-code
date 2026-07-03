import type { Decorator, Preview } from "@storybook/react-vite";
import * as React from "react";
import { addons } from "storybook/internal/preview-api";
import { GLOBALS_UPDATED, SET_GLOBALS } from "storybook/internal/core-events";
import { DocsAutodocsPage } from "./docs/DocsPage";
import { transformVeryfrontStorySource } from "./docs/transformStorySource";
import "./preview.css";

// Apply the selected colour mode to <html data-theme> — the attribute the chat
// tokens and preview.css read.
function applyTheme(globals?: { theme?: unknown }): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(
    "data-theme",
    globals?.theme === "dark" ? "dark" : "light",
  );
}

// The decorator only runs for CANVAS stories. Docs-page previews render via a
// direct call (see DocsExampleAuto) and bypass decorators, so the toggle
// wouldn't apply there. Listen on the addons channel instead — event-driven,
// no polling — which fires for both: SET_GLOBALS on init, GLOBALS_UPDATED on
// every toggle, everywhere in the preview iframe.
if (typeof document !== "undefined") {
  const channel = addons.getChannel();
  channel.on(SET_GLOBALS, (p: { globals?: { theme?: unknown } }) =>
    applyTheme(p?.globals));
  channel.on(GLOBALS_UPDATED, (p: { globals?: { theme?: unknown } }) =>
    applyTheme(p?.globals));
}

const withTheme: Decorator = (Story, context) => {
  applyTheme(context.globals);
  return <Story />;
};

const withVeryfrontSurface: Decorator = (Story) => (
  <div className="vf-story-shell">
    <Story />
  </div>
);

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Preview color mode",
      defaultValue: "light",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light Mode" },
          { value: "dark", title: "Dark Mode" },
        ],
      },
    },
  },
  decorators: [withTheme, withVeryfrontSurface],
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    backgrounds: { disable: true },
    controls: {
      expanded: true,
      // Disable the "save from controls" flow (removes the experimental
      // "Review new stories" / new-story indicators), matching Studio.
      disableSaveFromUI: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: false,
      page: DocsAutodocsPage,
      source: { transform: transformVeryfrontStorySource },
    },
    layout: "fullscreen",
    options: {
      // Overview sorts first; everything else stays alphabetical. Storybook
      // statically evaluates this function, so it must stay plain JS (no TS
      // annotations).
      storySort: (a, b) => {
        const aOverview = a.title === "Chat/Overview";
        const bOverview = b.title === "Chat/Overview";
        if (aOverview && !bOverview) return -1;
        if (bOverview && !aOverview) return 1;
        return a.title.localeCompare(b.title, undefined, { numeric: true });
      },
    },
  },
};

export default preview;
