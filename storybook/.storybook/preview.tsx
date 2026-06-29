import type { Decorator, Preview } from "@storybook/react-vite";
import * as React from "react";
import { DocsPage } from "./docs/DocsPage";
import { transformVeryfrontStorySource } from "./docs/transformStorySource";
import "./preview.css";

// Apply the selected preview color mode to <html data-theme> — the same
// attribute the framework's chat tokens and preview.css read.
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
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
      page: DocsPage,
      source: { transform: transformVeryfrontStorySource },
    },
    layout: "fullscreen",
    options: {
      // Overview sorts first; everything else stays alphabetical. Storybook
      // statically evaluates this function, so it must stay plain JS (no TS
      // annotations).
      storySort: (a, b) => {
        const aOverview = a.title === "Veryfront UI/Overview";
        const bOverview = b.title === "Veryfront UI/Overview";
        if (aOverview && !bOverview) return -1;
        if (bOverview && !aOverview) return 1;
        return a.title.localeCompare(b.title, undefined, { numeric: true });
      },
    },
  },
};

export default preview;
