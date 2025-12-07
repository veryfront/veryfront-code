export default {
  title: "My Docs",
  description: "Documentation built with Veryfront",

  // Documentation configuration
  docs: {
    sidebar: true,
    search: true,
    versions: ["v1", "v2"],
  },

  // Theme
  theme: {
    colors: {
      primary: "#0EA5E9",
      secondary: "#6366F1",
    },
  },

  // Development (port defaults to 3000)
  dev: {
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
        "fuse.js": "https://esm.sh/fuse.js@7.0.0",
      },
    },
  },

  cache: {
    dir: ".veryfront/cache",
    render: {
      type: "filesystem",
      ttl: 5 * 60 * 1000,
      maxEntries: 200,
    },
  },
};