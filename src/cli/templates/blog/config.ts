/**
 * Blog template - Configuration
 */

import type { TemplateFile } from "../types.ts";

export const blogConfigTemplates: TemplateFile[] = [
  {
    path: "veryfront.config.js",
    content: `export default {
  title: "My Blog",
  description: "A blog built with Veryfront",
  author: "Your Name",

  // Blog configuration
  blog: {
    postsPerPage: 10,
    rss: true,
    categories: ["Tech", "Life", "Code"],
  },

  // Theme
  theme: {
    colors: {
      primary: "#3B82F6",
      secondary: "#10B981",
    },
  },

  // Development
  dev: {
    port: 3002,
    open: true,
  },

  // Import map
  resolve: {
    importMap: {
      imports: {
        "react": "https://esm.sh/react@19.1.1",
        "react/jsx-runtime": "https://esm.sh/react@19.1.1/jsx-runtime",
        "react-dom": "https://esm.sh/react-dom@19.1.1",
        "react-dom/client": "https://esm.sh/react-dom@19.1.1/client",
        "date-fns": "https://esm.sh/date-fns@3.0.0",
      },
    },
  },
};`,
  },
];
