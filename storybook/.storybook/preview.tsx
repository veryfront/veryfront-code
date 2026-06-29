import type { Decorator, Preview } from "@storybook/react-vite";
import * as React from "react";
import "./preview.css";

const withVeryfrontSurface: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";

  return (
    <div className="vf-story-shell" data-theme={theme}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withVeryfrontSurface],
  globalTypes: {
    theme: {
      description: "Preview color mode",
      defaultValue: "light",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    backgrounds: { disable: true },
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: true,
    },
    layout: "fullscreen",
  },
};

export default preview;
