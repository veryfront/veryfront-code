export default {
  title: "My Veryfront App",
  description: "A minimal Veryfront starter",

  dev: {
    // Port defaults to 3000
    open: true,
  },

  resolve: {
    importMap: {
      imports: {
        "react": "https://esm.sh/react@19.1.1",
        "react/jsx-runtime": "https://esm.sh/react@19.1.1/jsx-runtime",
        "react-dom": "https://esm.sh/react-dom@19.1.1",
        "react-dom/client": "https://esm.sh/react-dom@19.1.1/client",
      },
    },
  },

  cache: {
    dir: ".veryfront/cache",
    render: {
      type: "memory",
      ttl: 60 * 1000,
      maxEntries: 200,
    },
  },
};
